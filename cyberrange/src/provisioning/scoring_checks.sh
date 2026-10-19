#!/bin/bash
#
# Agentless Scoring Verification Script (Phase 8 — Behavioral Upgrade)
# Purpose: Run on target containers (via SSH from Scoring Engine) to verify milestone completion
# Security: Read-only checks, no secrets stored on targets, no privileges required
#
# Usage: ssh -i key ubuntu@target /opt/cyberrange/scripts/scoring_checks.sh <scenario_id> <milestone_id>
#
# TIER 2 IMPROVEMENTS (June 8, 2026):
# 1. Behavioral Scoring: Added check_behavior function to parse .bash_history and snoopy logs.
# 2. Hybrid Verification: Prefers behavioral logs but falls back to artifacts for compatibility.
# 3. Enhanced Logging: Detailed behavior match results in /var/log/cyberrange-scoring.log.
#

set -euo pipefail

# === CONFIGURATION ===
SCENARIO_ID="${1:-}"
MILESTONE_ID="${2:-}"
TIMEOUT=10
LOG_FILE="${LOG_FILE:-/var/log/cyberrange-scoring.log}"

# === LOGGING ===
log() {
    local msg="[$(date +'%Y-%m-%d %H:%M:%S')] $*"
    { echo "$msg" >> "$LOG_FILE"; } 2>/dev/null || true
}

error() {
    log "ERROR: $*"
    exit 1
}

# === DEPENDENCY CHECKS ===
check_tool() {
    local tool=$1
    command -v "$tool" >/dev/null 2>&1 || return 1
}

ensure_tool() {
    local tool=$1
    if ! check_tool "$tool"; then
        echo "ERROR"
        return 1
    fi
    return 0
}

# === BEHAVIORAL CHECKS (Approach 1 & 2) ===
# Checks history files and snoopy logs for specific command patterns
check_behavior() {
    local pattern="$1"
    local log_type="${2:-all}" # history, snoopy, or all

    log "Checking behavior: pattern='$pattern', type=$log_type"

    # 1. Shell History Check (Approach 1)
    if [[ "$log_type" == "history" || "$log_type" == "all" ]]; then
        # Check root, all users in /home, and $HOME (for test overrides)
        local hist_targets=(/root/.bash_history /home/*/.bash_history /root/.zsh_history /home/*/.zsh_history)
        [[ -n "${HOME:-}" && -f "${HOME}/.bash_history" ]] && hist_targets+=("${HOME}/.bash_history")
        if grep -qE "$pattern" "${hist_targets[@]}" 2>/dev/null; then
            log "PASS: Found pattern in history"
            return 0
        fi
    fi

    # 2. Snoopy Log Check (Approach 2)
    if [[ "$log_type" == "snoopy" || "$log_type" == "all" ]]; then
        # Snoopy logs usually go to /var/log/auth.log or /var/log/syslog
        if grep -qE "snoopy.*$pattern" /var/log/auth.log /var/log/syslog 2>/dev/null; then
            log "PASS: Found pattern in snoopy logs"
            return 0
        fi
    fi

    return 1
}

# Guards against the false-PASS where a student typed the right nmap command
# but it never actually worked because eth0 was down (routing broken) at the
# time -- check_behavior only proves the command was typed, not that it
# succeeded. Confirms the container currently has a route to *some* pod
# subnet (10.0.<n>.0/24), which is exactly the condition that was missing
# when this bug surfaced (interface administratively down -> ip route empty).
has_subnet_route() {
    command -v ip >/dev/null 2>&1 || return 1
    ip -4 route show 2>/dev/null | grep -qE '^10\.0\.[0-9]+\.0/24 '
}

# This container's own "10.0.<n>" prefix, read from its actual eth0 address --
# not a hardcoded/guessed pod number. Using a bare [0-9]+ wildcard in the nmap
# target checks below would accept ANY pod's subnet, including one that isn't
# this student's own (e.g. crediting a scan of 10.0.55.0/24 while this
# student's real subnet is 10.0.51.0/24). Deriving it from the live interface
# ties the check to the actual pod, same spirit as has_subnet_route.
own_subnet_prefix() {
    command -v ip >/dev/null 2>&1 || return 0
    ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d'.' -f1-3 || true
}

# Metasploit console history (interactive msfconsole does not write .bash_history).
check_msf_history() {
    local pattern="$1"
    log "Checking msf history: pattern='$pattern'"
    local f
    for f in /home/student/.msf4/history /home/*/.msf4/history; do
        if [[ -f "$f" ]] && grep -qE "$pattern" "$f" 2>/dev/null; then
            log "PASS: Found pattern in $f"
            return 0
        fi
    done
    return 1
}

# Scenario 1 M4 requires a currently live Metasploit session, not merely a
# command in readline history. The portal puts the student in a persistent
# tmux session named "lab". We observe that pane without sending keys and
# correlate three facts: the pane is running Metasploit, its output records a
# Tomcat-manager session opened to this pod's meta IP, and the Metasploit child
# process still owns an established socket to that IP.
#
# Direct-bash tests use replace-only fixture files. The verifier never sets
# SCORING_TEST_MODE, and test mode fails closed unless every fixture is named.
#
# On failure S1_SESSION_REASON names the step that failed (Scenario 1
# diagnostics). It never decides PASS/FAIL.
check_live_tomcat_msf_session() {
    local prefix="$1"
    S1_SESSION_REASON=NO_POD_ADDRESS
    [[ -n "$prefix" ]] || return 1
    local target="${prefix}.20"
    local pane_info pane_output socket_output pane_pid pane_cmd msf_pid msf_cmdline session_peer

    S1_SESSION_REASON=CHECK_ERROR
    if [[ "${SCORING_TEST_MODE:-0}" == "1" ]]; then
        [[ -n "${SCORING_TEST_PANE_INFO_FILE:-}" && -f "$SCORING_TEST_PANE_INFO_FILE" ]] || return 1
        [[ -n "${SCORING_TEST_PANE_OUTPUT_FILE:-}" && -f "$SCORING_TEST_PANE_OUTPUT_FILE" ]] || return 1
        [[ -n "${SCORING_TEST_SOCKET_OUTPUT_FILE:-}" && -f "$SCORING_TEST_SOCKET_OUTPUT_FILE" ]] || return 1
        pane_info=$(cat "$SCORING_TEST_PANE_INFO_FILE")
        pane_output=$(cat "$SCORING_TEST_PANE_OUTPUT_FILE")
        socket_output=$(cat "$SCORING_TEST_SOCKET_OUTPUT_FILE")
    else
        command -v runuser >/dev/null 2>&1 || return 1
        command -v tmux >/dev/null 2>&1 || return 1
        command -v ss >/dev/null 2>&1 || return 1
        pane_info=$(runuser -u student -- tmux list-panes -t lab -F '#{pane_pid}|#{pane_current_command}' 2>/dev/null || true)
        pane_output=$(runuser -u student -- tmux capture-pane -p -J -S - -t lab 2>/dev/null || true)
        socket_output=$(ss -Htnp state established 2>/dev/null || true)
    fi

    # Exactly one active lab pane is expected. Reject ambiguous/malformed data.
    S1_SESSION_REASON=MSF_NOT_RUNNING
    [[ $(printf '%s\n' "$pane_info" | grep -c .) -eq 1 ]] || return 1
    IFS='|' read -r pane_pid pane_cmd <<< "$pane_info"
    S1_SESSION_REASON=CHECK_ERROR
    [[ "$pane_pid" =~ ^[0-9]+$ ]] || return 1
    S1_SESSION_REASON=MSF_NOT_RUNNING
    [[ "$pane_cmd" =~ ^(ruby|msfconsole)$ ]] || return 1

    # Arm only on an explicit run/exploit at the Tomcat module prompt. Any other
    # Metasploit prompt clears arming, so an echo entered after module selection
    # cannot forge the session-open event. Pane text itself remains untrusted;
    # the strict full-prompt spoof regression tracks the RPC provenance gap.
    S1_SESSION_REASON=SESSION_NOT_OPENED
    session_peer=$(printf '%s\n' "$pane_output" | awk -v target="$target" '
        /(^|[[:space:]])msf[0-9]* .* >[[:space:]]/ {
            armed = ($0 ~ /exploit\(multi\/http\/tomcat_mgr_deploy\)[[:space:]]*>[[:space:]]*(run|exploit)([[:space:]]|$)/)
            next
        }
        armed && /(Meterpreter|Command shell) session [0-9]+ opened/ {
            arrow=index($0, "-> ")
            if (!arrow) next
            peer=substr($0, arrow+3)
            sub(/[[:space:])].*$/, "", peer)
            if (peer ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$/) {
                split(peer, endpoint, ":")
                if (endpoint[1] == target) found=peer
            }
        }
        END { if (found) print found; else exit 1 }
    ') || return 1

    # tmux pane_pid is normally the shell; msfconsole's Ruby process is its
    # child. Accept the pane PID itself or a direct child, then require ss to
    # attribute the target-bound established connection to that PID.
    S1_SESSION_REASON=SESSION_NOT_LIVE
    local candidate_pids="$pane_pid"
    if [[ "${SCORING_TEST_MODE:-0}" == "1" ]]; then
        candidate_pids+=" ${SCORING_TEST_MSF_PID:-}"
    else
        candidate_pids+=" $(pgrep -P "$pane_pid" 2>/dev/null || true)"
    fi
    for msf_pid in $candidate_pids; do
        [[ "$msf_pid" =~ ^[0-9]+$ ]] || continue
        if [[ "${SCORING_TEST_MODE:-0}" == "1" ]]; then
            msf_cmdline="${SCORING_TEST_MSF_CMDLINE:-}"
        else
            [[ -r "/proc/$msf_pid/cmdline" ]] || continue
            msf_cmdline=$(tr '\0' ' ' < "/proc/$msf_pid/cmdline" 2>/dev/null || true)
        fi
        [[ "$msf_cmdline" =~ (^|[[:space:]/])msfconsole([[:space:]]|$) ]] || continue
        if printf '%s\n' "$socket_output" | grep -F "$session_peer" | grep -qE "pid=${msf_pid}([,\)])"; then
            log "PASS: live tomcat_mgr_deploy Metasploit session to $target (pid=$msf_pid)"
            S1_SESSION_REASON=NONE
            return 0
        fi
    done
    return 1
}

# === VALIDATION ===
[[ -n "$SCENARIO_ID" ]] || error "SCENARIO_ID required"
[[ -n "$MILESTONE_ID" ]] || error "MILESTONE_ID required"

log "Scoring check: scenario=$SCENARIO_ID, milestone=$MILESTONE_ID"

# === VERIFICATION FUNCTIONS ===

# Scenario 1: Network Reconnaissance (Kali attacker perspective)
#
# Diagnostics (instructor-only): before the PASS/FAIL token each milestone prints
#   DIAG reason=<CODE> location=NONE copies=0
# Callers read only the last stdout line, so the token contract is unchanged.
# CODE is from the fixed set below -- never a command, an address, or pane
# text. NONE = passed.
#   NO_POD_ADDRESS NO_SUBNET_ROUTE COMMAND_NOT_FOUND COMMAND_NOT_MATCHED
#   MSF_NOT_RUNNING SESSION_NOT_OPENED SESSION_NOT_LIVE CHECK_ERROR
# Each milestone runs the same predicates in the same order as before and
# names the first one that fails. PASS is printed only for NONE.

# Which part of an nmap check failed: no nmap run at all, or none that matched.
# Anchored to an nmap invocation with an argument (start of line, or after a
# space, ;, &, | or /), so `man nmap`, `apt install nmap` or `zenmap` count as
# not found rather than as a wrong scan.
_S1_NMAP_RUN='(^|[;&|/[:space:]])nmap[[:space:]]+[^[:space:]]'
_s1_command_reason() {
    if check_behavior "$_S1_NMAP_RUN"; then echo COMMAND_NOT_MATCHED; else echo COMMAND_NOT_FOUND; fi
}

# M1/M3: [[ prefix ]] && check_behavior PATTERN && has_subnet_route.
_s1_scan_reason() {
    local prefix="$1" pattern="$2"
    # Without ip, own_subnet_prefix and has_subnet_route fail for a missing tool,
    # not a network fault.
    command -v ip >/dev/null 2>&1 || { echo CHECK_ERROR; return 0; }
    [[ -n "$prefix" ]] || { echo NO_POD_ADDRESS; return 0; }
    check_behavior "$pattern" || { _s1_command_reason; return 0; }
    has_subnet_route || { echo NO_SUBNET_ROUTE; return 0; }
    echo NONE
}

# M2 checks the address and the route first, then the command.
_s1_route_first_reason() {
    local prefix="$1" pattern="$2"
    command -v ip >/dev/null 2>&1 || { echo CHECK_ERROR; return 0; }
    [[ -n "$prefix" ]] || { echo NO_POD_ADDRESS; return 0; }
    has_subnet_route || { echo NO_SUBNET_ROUTE; return 0; }
    check_behavior "$pattern" || { _s1_command_reason; return 0; }
    echo NONE
}

_s1_m4_reason() {
    command -v ip >/dev/null 2>&1 || { echo CHECK_ERROR; return 0; }
    S1_SESSION_REASON=CHECK_ERROR
    check_live_tomcat_msf_session "$1" || true
    echo "${S1_SESSION_REASON:-CHECK_ERROR}"
}

check_scenario_1() {
    local milestone=$1
    local prefix esc reason
    prefix=$(own_subnet_prefix)
    if [[ -z "$prefix" && "$milestone" != "4" ]]; then
        log "WARN: no IPv4 on eth0; scenario 1 M1-M3 will FAIL"
    fi
    esc="${prefix//./\\.}"  # escape dots for regex use
    case $milestone in
        1)
            # M1: Host Discovery (nmap -sn against THIS pod's actual /24
            # network address, e.g. 10.0.51.0/24 -- derived live from eth0
            # via own_subnet_prefix, not a hardcoded number or a bare
            # [0-9]+ wildcard.
            #
            # Two earlier, narrower bugs both stemmed from the same root
            # cause -- matching loosely instead of anchoring to the real
            # target: (1) "nmap.*10\.0\.[0-9]+\." matched any text
            # containing "10.0.<n>." anywhere, so a mistyped target like
            # "10.0.51.1/20" (wrong host octet, wrong prefix length) still
            # matched; (2) even after anchoring to ".0/24", a bare [0-9]+
            # for the subnet octet would have credited scanning a
            # *different* pod's subnet (e.g. 10.0.55.0/24) as if it were
            # this student's own.
            #
            # has_subnet_route guards against a false PASS from a
            # correctly-typed command that never actually worked because
            # eth0 was down at the time (see provisioning's
            # ensure_guest_nic_up / R7e) -- checked at verify time, not
            # history time, so it reflects current reality.
            reason=$(_s1_scan_reason "$prefix" "nmap.*${esc}\.0/24") || reason=CHECK_ERROR
            ;;
        2)
            # M2: Port Enumeration — prefer -p / -F / port list against this
            # pod's actual meta/dvwa host (.20/.30), not any pod's. The old
            # fallback "nmap.*-p |nmap -F " required no target at all (any
            # -p/-F scan of anything passed) -- dropped rather than tightened,
            # since a port scan of the wrong host isn't port enumeration of
            # the target.
            reason=$(_s1_route_first_reason "$prefix" "nmap.*(-p|-F).*${esc}\.(20|30)|nmap.*${esc}\.(20|30).*(-p|-F)") || reason=CHECK_ERROR
            ;;
        3)
            # M3: Service Version Detection (nmap -sV against this pod's real
            # victim host). Old pattern "nmap.*-sV" matched -sV anywhere in
            # history regardless of target, so a scan against a mistyped/
            # nonexistent IP (10.0.51.19 when meta is .20) or even another
            # pod's subnet still credited full points despite nmap itself
            # reporting 0 hosts up. Anchor to THIS pod's actual victim IPs,
            # in either flag/IP order a student might type.
            reason=$(_s1_scan_reason "$prefix" "nmap.*-sV.*${esc}\.(20|30)|nmap.*${esc}\.(20|30).*-sV") || reason=CHECK_ERROR
            ;;
        4)
            # M4: Exploit Tomcat manager on the meta target (merged from scenario 3;
            # require a live target-correlated Metasploit session on Kali.)
            reason=$(_s1_m4_reason "$prefix") || reason=CHECK_ERROR
            ;;
        *) return ;;
    esac
    [[ -n "$reason" ]] || reason=CHECK_ERROR
    printf 'DIAG reason=%s location=NONE copies=0\n' "$reason"
    if [[ "$reason" == NONE ]]; then echo "PASS"; else echo "FAIL"; fi
}

# Scenario 2: SSH Brute Force (Kali attacker perspective; meta = msfadmin)
check_scenario_2() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Hydra brute force against msfadmin@meta SSH
            if check_behavior "hydra.*-l msfadmin.*ssh|hydra.*msfadmin.*ssh|ncrack.*msfadmin.*ssh"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        2)
            # M2: SSH login as msfadmin after Hydra
            if check_behavior "ssh.*msfadmin@|ssh msfadmin@"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        3)
            # M3: Read lab flag on meta (via SSH session history)
            if check_behavior "cat.*/home/msfadmin/flag|flag\.txt"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
    esac
}

# Scenario 3: Tomcat CVE exploitation (Kali attacker; target meta:8180)
check_scenario_3() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Service scan for Tomcat on 8180
            if check_behavior "nmap.*8180|nmap.*-sV.*8180"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        2)
            # M2: Metasploit tomcat_mgr_deploy (msf history, not bash_history)
            if check_msf_history "tomcat_mgr_deploy|exploit/multi/http/tomcat_mgr_deploy"; then echo "PASS"; return; fi
            if check_behavior "tomcat_mgr_deploy|msfconsole.*tomcat"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        3)
            # M3: Post-exploit confirmation in msf session
            if check_msf_history "sessions|cat /etc/passwd|whoami"; then echo "PASS"; return; fi
            if check_behavior "cat /etc/passwd|sessions -i"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
    esac
}

# Scenario 4: Privilege Escalation (Linux kernel)
check_scenario_4() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Vulnerability identified
            if check_behavior "linux-exploit-suggester|les\.sh"; then echo "PASS"; return; fi
            # Fallback
            if uname -r | grep -qE "4\.[0-4]\.|5\.[0-9]\." 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        2)
            # M2: Exploit compiled
            if check_behavior "gcc.*-o exploit|gcc.*-o privesc"; then echo "PASS"; return; fi
            # Fallback
            if [[ -x /tmp/exploit ]] || [[ -x /tmp/privesc ]]; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        3)
            # M3: Root shell obtained
            if check_behavior "id" && [[ $(id -u) -eq 0 ]]; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /root/proof_privesc.txt ]] && grep -q "uid=0" /root/proof_privesc.txt 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
    esac
}

# Scenario 5: Metasploit Framework
check_scenario_5() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Metasploit console accessible
            if check_behavior "msfconsole"; then echo "PASS"; return; fi
            if ! ensure_tool msfconsole; then return; fi
            if timeout $TIMEOUT msfconsole -v 2>/dev/null | grep -q "Metasploit Framework"; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        2)
            # M2: Exploit module loaded
            if check_behavior "use exploit|use payload|msfconsole.*-x.*use"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/msfmodules.txt ]] && grep -q "exploit\|payload" /tmp/msfmodules.txt; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        3)
            # M3: Handler session established
            if check_behavior "exploit|run|sessions -i"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/msfhandler.log ]] && grep -q "Session.*opened" /tmp/msfhandler.log 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
    esac
}

# Scenario 6: SQL Injection — checked on KALI (attacker history + optional flag file).
# SCENARIO_TARGETS[6]=kali. Browser SQLi hits DVWA; sqlmap runs from Kali.
# Guide paste is not evidence. Env vars the student was taught ($TARGET_DVWA,
# $TARGET_KALI) are evidence: bash history stores them unexpanded.
# NOTE: use `case` globs, not a [[ =~ ]] regex. `\<` / `\>` are GNU word-boundary
# anchors in glibc regex (the Kali pod + Linux CI), so `\<[A-Za-z0-9_]+\>` there
# matches ANY word and would flag every real command as a placeholder. It only
# looks correct on Windows git-bash (literal `<`). The globs below behave the
# same on every shell.
history_line_normalize() {
    # Strip zsh EXTENDED_HISTORY ": <unix>:<duration>;" and leading whitespace.
    local line="$1"
    if [[ "$line" =~ ^:\ [0-9]+:[0-9]+\;(.*)$ ]]; then
        line="${BASH_REMATCH[1]}"
    fi
    line="${line#"${line%%[![:space:]]*}"}"
    printf '%s\n' "$line"
}

history_line_is_placeholder() {
    local line
    line="$(history_line_normalize "$1")"
    # Guide paste: echo/printf as a command (start of line or after ; && || |)
    if printf '%s\n' "$line" | grep -qE '(^|[;&|[:space:]])[[:space:]]*(echo|printf)([[:space:]]|$)'; then
        return 0
    fi
    case "$line" in
        *"manual sqli probe:"*) return 0 ;;   # the guide's literal probe string
        *"<"*">"*)              return 0 ;;   # any <...> placeholder token
    esac
    return 1
}

# Case-insensitive. Drops placeholder and echo/printf lines before matching.
# Also scans Snoopy logs (same filter) so a real sqlmap that never hit
# interactive history can still PASS with a valid hash file.
history_has_real_line() {
    local pattern="$1"
    local hist_targets=(/root/.bash_history /home/*/.bash_history /root/.zsh_history /home/*/.zsh_history)
    [[ -n "${HOME:-}" && -f "${HOME}/.bash_history" ]] && hist_targets+=("${HOME}/.bash_history")
    [[ -n "${HOME:-}" && -f "${HOME}/.zsh_history" ]] && hist_targets+=("${HOME}/.zsh_history")
    local f line
    for f in "${hist_targets[@]}"; do
        [[ -f "$f" ]] || continue
        while IFS= read -r line || [[ -n "$line" ]]; do
            history_line_is_placeholder "$line" && continue
            if printf '%s\n' "$line" | grep -qiE "$pattern"; then
                log "PASS: real history line matched $pattern"
                return 0
            fi
        done < "$f"
    done
    local snoopy_targets=(/var/log/auth.log /var/log/syslog)
    [[ -n "${SNOOPY_LOG_FILE:-}" && -f "${SNOOPY_LOG_FILE}" ]] && snoopy_targets=("${SNOOPY_LOG_FILE}")
    for f in "${snoopy_targets[@]}"; do
        [[ -f "$f" ]] || continue
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ "$line" == *snoopy* ]] || continue
            history_line_is_placeholder "$line" && continue
            if printf '%s\n' "$line" | grep -qiE "$pattern"; then
                log "PASS: real snoopy line matched $pattern"
                return 0
            fi
        done < "$f"
    done
    return 1
}

sqli_users_file() { printf '%s\n' "${SQLI_USERS_FILE:-/tmp/sqli_users.txt}"; }
admin_hash_file() { printf '%s\n' "${ADMIN_HASH_FILE:-/tmp/admin_hash.txt}"; }

check_scenario_6() {
    local milestone=$1
    local users_file hash_file probe
    users_file="$(sqli_users_file)"
    hash_file="$(admin_hash_file)"
    case $milestone in
        1)
            # Real curl: OR / %27 must sit inside the id= value (finding 3 + 8).
            # Stop the id value at & / space / quote so a trailing shell quote
            # after plain id=1 cannot match. Bare ' alone is not enough; require
            # or…1 or %27. Allow '+' (URL space) around or. $TARGET_DVWA is fine.
            if history_has_real_line 'curl.*vulnerabilities/sqli.*id=[^&[:space:]'"'"'\"]*(%27|'"'"'*(\+|[[:space:]])*or(\+|[[:space:]])*['"'"'\"]?1)'; then
                echo "PASS"; return
            fi
            # Artifact proof (#104). History cannot see the SQL error body.
            if [[ -n "${SQLI_PROBE_FILE:-}" ]]; then
                set -- "$SQLI_PROBE_FILE"
            else
                set -- /tmp/sqli_probe.txt /tmp/sqli_injection.txt
            fi
            for probe in "$@"; do
                if [[ -f "$probe" ]] && grep -qiE 'syntax.*error|error.*syntax|ID:[[:space:]]*1'"'"'|First name:' "$probe"; then
                    echo "PASS"; return
                fi
            done
            echo "FAIL"
            ;;
        2)
            # Extracted row: username plus a 32-hex MD5. The UNION sentence alone does not count.
            if [[ -f "$users_file" ]] && grep -qE '^[A-Za-z0-9_]+:[0-9a-fA-F]{32}[[:space:]]*$' "$users_file" \
                && ! grep -qiE '<|UNION SELECT' "$users_file"; then
                echo "PASS"; return
            fi
            echo "FAIL"
            ;;
        3)
            # Real sqlmap line (angle-bracket cookie rejected) AND a 32-hex hash file.
            # A non-empty sqlmap log file alone is intentionally not a pass path.
            if history_has_real_line 'sqlmap.*(--dump|-T[[:space:]]+users|--tables)' \
                && [[ -f "$hash_file" ]] \
                && grep -qE '(^|[^0-9a-fA-F])[0-9a-fA-F]{32}([^0-9a-fA-F]|$)' "$hash_file" \
                && ! grep -q '<' "$hash_file"; then
                echo "PASS"; return
            fi
            echo "FAIL"
            ;;
        4)
            # M4: Reflected XSS executed against DVWA XSS module
            # Behavioral check: curl command targeting DVWA xss_r with script payload in request
            if check_behavior "(curl.*xss_r.*(<|%3[cC])[sS][cC][rR][iI][pP][tT])"; then echo "PASS"; return; fi
            # Artifact check: response containing DVWA Low unescaped reflection "Hello <script..."
            for f in /tmp/xss_reflected.txt /tmp/xss_payload.txt /tmp/xss_proof.txt; do
                if [[ -f "$f" ]] && [[ -s "$f" ]]; then
                    if grep -qiE "hello[[:space:]]*<script" "$f"; then
                        echo "PASS"
                        return
                    fi
                fi
            done
            echo "FAIL"
            ;;
    esac
}

# Scenario 7: Password Cracking
check_scenario_7() {
    local milestone=$1
    case $milestone in
        1)
            # M1: /etc/shadow copied to attacker
            if check_behavior "cp /etc/shadow|cat /etc/shadow"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/shadow.txt ]] && grep -q "^[^:]*:[^:]*:[0-9]*:" /tmp/shadow.txt 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        2)
            # M2: Hash type identified
            if check_behavior "hashid|hash-identifier"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/hashtype.txt ]] && grep -qE "SHA-512|SHA-256|MD5" /tmp/hashtype.txt 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        3)
            # M3: Hashes cracked
            if check_behavior "john|hashcat"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/cracked.txt ]] && grep -q "^[^:]*:[^:]*$" /tmp/cracked.txt 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
    esac
}

# Scenario 8: Persistence & Backdoors
check_scenario_8() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Cron backdoor installed
            if check_behavior "crontab -e|echo.*cron"; then echo "PASS"; return; fi
            # Fallback
            if (crontab -l 2>/dev/null | grep -qiE "bash|sh|python" && [[ -f /tmp/backdoor.sh ]] || grep -r "backdoor" /etc/cron.d 2>/dev/null | grep -q .) >/dev/null 2>&1; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        2)
            # M2: SSH key persistence
            if check_behavior "ssh-keygen|authorized_keys"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /root/.ssh/authorized_keys ]] && [[ $(wc -l < /root/.ssh/authorized_keys) -gt 1 || -n "$(find /root/.ssh/authorized_keys -mmin -30 2>/dev/null)" ]]; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        3)
            # M3: Systemd service persistence
            if check_behavior "systemctl enable|cp.*\.service /etc/systemd/system"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /etc/systemd/system/backdoor.service ]] || systemctl list-units --all 2>/dev/null | grep -qi "backdoor"; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
    esac
}

# Scenario 9: guide fiction fingerprints (section 5 example). Fixed strings only.
# Prefer grep -qF on lowercased text: GNU grep 3.0 (Git Bash) aborts grep -qiF.
_s9_contains_guide_fiction() {
    local f="$1" lower
    [[ -f "$f" ]] || return 1
    lower=$(tr '[:upper:]' '[:lower:]' < "$f" 2>/dev/null) || return 1
    grep -qF 'pod-example-meta' <<< "$lower" 2>/dev/null && return 0
    grep -qF 'case-example' <<< "$lower" 2>/dev/null && return 0
    grep -qF '2026-10-10t06:32:00z' <<< "$lower" 2>/dev/null && return 0
    return 1
}

# Scenario 9: unfilled guide skeleton tokens. Case-sensitive uppercase PASTE_* only
# so English "paste" / "pasted" in honest notes does not false-fail.
_s9_contains_unfilled_tokens() {
    local f="$1"
    [[ -f "$f" ]] || return 1
    grep -qF 'PASTE_SIEM_TIMESTAMP_Z' "$f" 2>/dev/null && return 0
    grep -qF 'PASTE SIEM DESCRIPTION' "$f" 2>/dev/null && return 0
    grep -qF 'PASTE YOUR pod-' "$f" 2>/dev/null && return 0
    grep -qF 'PASTE FULL SIEM TIMESTAMP' "$f" 2>/dev/null && return 0
    grep -qF 'PASTE…' "$f" 2>/dev/null && return 0
    grep -qF 'PASTE...' "$f" 2>/dev/null && return 0
    grep -qF 'HH:MM' "$f" 2>/dev/null && return 0
    grep -qE '<(your|actual|observed|SIEM|failed)[^>]*>' "$f" 2>/dev/null && return 0
    return 1
}

# Scenario 9 M1: agent must match this pod (hostname / Wazuh name).
# SCORING_S9_EXPECTED_AGENT is a test seam only (same idea as S9_AUTHLOG / S9_NOW).
_s9_has_lab_meta_agent() {
    local f="$1" line agent lower expected expected_lower
    [[ -f "$f" ]] || return 1
    expected=$(_s9_expected_agent) || return 1
    expected_lower=$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')
    while IFS= read -r line; do
        # LXD names: letters, digits, hyphens only — no '.' / '_' (blocks pod-...-meta).
        [[ "$line" =~ [Aa]gent[^[:alnum:]]+\"?(pod-[A-Za-z0-9][A-Za-z0-9-]*-meta)\"? ]] || continue
        agent="${BASH_REMATCH[1]}"
        lower=$(printf '%s' "$agent" | tr '[:upper:]' '[:lower:]')
        [[ "$lower" == "$expected_lower" ]] || continue
        return 0
    done < "$f"
    return 1
}

# Scenario 9 M3: report names this pod's agent.
# Avoid grep -qiF: GNU grep 3.0 (Git Bash) aborts that flag combo (exit 134).
_s9_report_names_expected_agent() {
    local f="$1" expected expected_lower
    [[ -f "$f" ]] || return 1
    expected=$(_s9_expected_agent) || return 1
    expected_lower=$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')
    # LXD agent names are [A-Za-z0-9-]; -qiE is safe and portable here.
    grep -qiE "$expected_lower" "$f" 2>/dev/null
}

# Scenario 9: file mentions rule 5710 (JSON "rule":"5710" or prose).
_s9_mentions_rule_5710() {
    local f="$1"
    [[ -f "$f" ]] || return 1
    grep -qiE '(^|[^0-9])5710([^0-9]|$)' "$f" 2>/dev/null
}

# Scenario 9: expected agent short name (hostname / test seam), FQDN-stripped.
_s9_expected_agent() {
    local expected
    expected="${SCORING_S9_EXPECTED_AGENT:-$(hostname 2>/dev/null)}"
    expected="${expected%%.*}"
    [[ -n "$expected" ]] || return 1
    printf '%s\n' "$expected"
}

# Scenario 9: claim epoch $1 is within +/- $3 minutes of event epoch $2. When $4
# is 1, also accept the event's clock time read in a local zone and labeled Z:
# claim = event + h hours (h in -12..+14, real UTC offsets) within 60 s. A local
# copy keeps minutes/seconds, so the shifted window stays tight; callers allow the
# shift for one stamp only so a list of guesses can't cover every minute (#218).
_s9_claim_matches_event() {
    local claim_epoch="$1" event_epoch="$2" tol="$3" allow_shift="${4:-0}"
    local diff abs hours residual
    diff=$((claim_epoch - event_epoch))
    abs=$diff
    (( abs < 0 )) && abs=$((-abs))
    (( abs <= tol * 60 )) && return 0
    [[ "$allow_shift" == 1 ]] || return 1
    hours=$(( (abs + 1800) / 3600 ))
    (( diff < 0 )) && hours=$((-hours))
    (( hours != 0 && hours >= -12 && hours <= 14 )) || return 1
    residual=$((diff - hours * 3600))
    (( residual < 0 )) && residual=$((-residual))
    (( residual <= 60 ))
}

# Scenario 9: at least one ISO …Z in the file matches a real invalid-user auth.log
# event within +/- $2 minutes (same clock rules as M2); only the file's first valid
# …Z may match via a whole-hour timezone shift. Rule need not share a line.
_s9_has_real_event_timestamp() {
    local f="$1" tol="${2:-5}"
    local authlog="${S9_AUTHLOG:-}" path
    local allow_shift first_stamp=1
    local now_epoch now_year candidate_year month day clock event_epoch
    local nearest_epoch nearest_distance distance claim_stamp claim_base claim_epoch round_trip
    local timestamp_re='20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?Z'
    local month_number

    [[ -f "$f" ]] || return 1
    [[ "$tol" =~ ^[0-9]+$ ]] || return 1
    if [[ -z "$authlog" ]]; then
        for path in /var/log/auth.log /var/log/secure; do
            if [[ -f "$path" ]]; then authlog="$path"; break; fi
        done
    fi
    [[ -z "$authlog" || ! -f "$authlog" ]] && return 1

    if [[ -n "${S9_NOW:-}" ]]; then
        [[ "$S9_NOW" =~ ^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$ ]] || return 1
        round_trip=$(TZ=UTC0 LC_ALL=C date -u -d "$S9_NOW" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) || return 1
        [[ "$round_trip" == "$S9_NOW" ]] || return 1
        now_epoch=$(TZ=UTC0 LC_ALL=C date -u -d "$S9_NOW" '+%s' 2>/dev/null) || return 1
    else
        now_epoch=$(TZ=UTC0 LC_ALL=C date -u '+%s' 2>/dev/null) || return 1
    fi
    now_year=$(TZ=UTC0 LC_ALL=C date -u -d "@$now_epoch" '+%Y' 2>/dev/null) || return 1

    while IFS= read -r claim_stamp; do
        [[ "$claim_stamp" =~ ^$timestamp_re$ ]] || continue
        claim_base=$(printf '%s' "$claim_stamp" | sed -E 's/\.[0-9]{1,3}Z$/Z/')
        round_trip=$(TZ=UTC0 LC_ALL=C date -u -d "$claim_stamp" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) || continue
        [[ "$round_trip" == "$claim_base" ]] || continue
        claim_epoch=$(TZ=UTC0 LC_ALL=C date -u -d "$claim_stamp" '+%s' 2>/dev/null) || continue
        # Only a valid date takes the one shift slot (an invalid one can't match anyway).
        allow_shift=$first_stamp
        first_stamp=0

        while IFS= read -r event; do
            [[ "$event" == *'flag-m1-'* ]] && continue
            [[ "$event" =~ sshd\[[0-9]+\]:.*Invalid\ user[[:space:]]+[^[:space:]]+[[:space:]]+from[[:space:]]+[0-9A-Fa-f:.]+ ]] || continue
            [[ "$event" =~ ^([A-Z][a-z]{2})[[:space:]]+([0-9]{1,2})[[:space:]]+([0-9]{2}:[0-9]{2}:[0-9]{2}) ]] || continue
            month="${BASH_REMATCH[1]}"
            day="${BASH_REMATCH[2]}"
            clock="${BASH_REMATCH[3]}"
            printf -v day '%02d' "$day"
            case "$month" in
                Jan) month_number=01 ;; Feb) month_number=02 ;; Mar) month_number=03 ;;
                Apr) month_number=04 ;; May) month_number=05 ;; Jun) month_number=06 ;;
                Jul) month_number=07 ;; Aug) month_number=08 ;; Sep) month_number=09 ;;
                Oct) month_number=10 ;; Nov) month_number=11 ;; Dec) month_number=12 ;;
                *) continue ;;
            esac

            nearest_epoch=''
            nearest_distance=''
            for candidate_year in "$((now_year - 1))" "$now_year" "$((now_year + 1))"; do
                event_epoch=$(TZ=UTC0 LC_ALL=C date -u -d "${candidate_year}-${month_number}-${day}T${clock}Z" '+%s' 2>/dev/null) || continue
                round_trip=$(TZ=UTC0 LC_ALL=C date -u -d "@$event_epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) || continue
                [[ "$round_trip" == "${candidate_year}-${month_number}-${day}T${clock}Z" ]] || continue
                distance=$((event_epoch - now_epoch))
                (( distance < 0 )) && distance=$((-distance))
                if [[ -z "$nearest_distance" ]] || (( distance < nearest_distance )); then
                    nearest_epoch="$event_epoch"
                    nearest_distance="$distance"
                fi
            done
            [[ -n "$nearest_epoch" ]] || continue

            _s9_claim_matches_event "$claim_epoch" "$nearest_epoch" "$tol" "$allow_shift" && return 0
        done < <(grep -hiE 'invalid user' "$authlog" 2>/dev/null | grep -iE 'from ')
    done < <(grep -Eo "$timestamp_re" "$f" 2>/dev/null)

    return 1
}

# Scenario 9 M3: leftover body after the five guide headings must be >= 120 bytes.
_s9_report_body_bytes() {
    local f="$1"
    [[ -f "$f" ]] || { echo 0; return; }
    # Strip common heading lines, then count remaining non-whitespace bytes loosely via wc -c on filtered text
    local body
    body=$(grep -viE '^[[:space:]]*(Summary|Affected system|Evidence|Interpretation|Recommended response)[[:space:]]*:[[:space:]]*$' "$f" 2>/dev/null | tr -d '[:space:]')
    echo "${#body}"
}

# Scenario 9 M3: lightly edited §5 example (need ≥2 of 3 fingerprints).
_s9_looks_like_example_report() {
    local f="$1" hits=0 lower
    [[ -f "$f" ]] || return 1
    lower=$(tr '[:upper:]' '[:lower:]' < "$f" 2>/dev/null) || return 1
    grep -qF 'pod-example-meta' <<< "$lower" 2>/dev/null && hits=$((hits + 1))
    grep -qF '10 october 2026' <<< "$lower" 2>/dev/null && hits=$((hits + 1))
    grep -qF 'nonexistent-user ssh attempt' <<< "$lower" 2>/dev/null && hits=$((hits + 1))
    (( hits >= 2 ))
}

# Scenario 9 M2 helper: is a full UTC timestamp claimed alongside Rule 5710 in
# the timeline within +/- $2 minutes of a real sshd invalid-user event? Only the
# first valid such timestamp may match via a whole-hour timezone shift
# (_s9_claim_matches_event), so extra lines or stamps can't enumerate minutes.
#
# `auth.log` uses UTC syslog timestamps without a year. Infer each event's year
# from the trusted container UTC clock (nearest current/adjacent year), never
# from the student's claim. The SIEM displays UTC and the guide asks students
# to copy/record an ISO-8601 `Z` timestamp.
# Runs as root in-container (lxc exec), so /var/log/auth.log is readable.
# Returns 0 on a match, 1 otherwise.
_s9_timeline_time_is_real() {
    local timeline="$1" tol="${2:-5}"
    # S9_AUTHLOG overrides the source log (used by tests); production probes the
    # real sshd log that the Wazuh agent on meta also reads for rule 5710.
    local authlog="${S9_AUTHLOG:-}" f
    if [[ -z "$authlog" ]]; then
        for f in /var/log/auth.log /var/log/secure; do
            if [[ -f "$f" ]]; then authlog="$f"; break; fi
        done
    fi
    [[ -z "$authlog" || ! -f "$authlog" ]] && return 1
    [[ "$tol" =~ ^[0-9]+$ ]] || return 1

    local now_epoch now_year candidate_year month day clock event_epoch
    local nearest_epoch nearest_distance distance claim_stamp claim_base claim_epoch round_trip
    local timestamp_re='20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?Z'
    local month_number allow_shift first_stamp=1

    # S9_NOW is a deterministic test seam only; production uses the container clock.
    if [[ -n "${S9_NOW:-}" ]]; then
        [[ "$S9_NOW" =~ ^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$ ]] || return 1
        round_trip=$(TZ=UTC0 LC_ALL=C date -u -d "$S9_NOW" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) || return 1
        [[ "$round_trip" == "$S9_NOW" ]] || return 1
        now_epoch=$(TZ=UTC0 LC_ALL=C date -u -d "$S9_NOW" '+%s' 2>/dev/null) || return 1
    else
        now_epoch=$(TZ=UTC0 LC_ALL=C date -u '+%s' 2>/dev/null) || return 1
    fi
    now_year=$(TZ=UTC0 LC_ALL=C date -u -d "@$now_epoch" '+%Y' 2>/dev/null) || return 1

    while IFS= read -r line; do
        [[ "$line" =~ [Rr]ule[^0-9]{0,15}5710([^0-9]|$) ]] || continue
        while IFS= read -r claim_stamp; do
            [[ "$claim_stamp" =~ ^$timestamp_re$ ]] || continue
            claim_base=$(printf '%s' "$claim_stamp" | sed -E 's/\.[0-9]{1,3}Z$/Z/')
            round_trip=$(TZ=UTC0 LC_ALL=C date -u -d "$claim_stamp" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) || continue
            [[ "$round_trip" == "$claim_base" ]] || continue
            claim_epoch=$(TZ=UTC0 LC_ALL=C date -u -d "$claim_stamp" '+%s' 2>/dev/null) || continue
            # Only a valid date takes the one shift slot (an invalid one can't match anyway).
            allow_shift=$first_stamp
            first_stamp=0

            while IFS= read -r event; do
                [[ "$event" == *'flag-m1-'* ]] && continue
                [[ "$event" =~ sshd\[[0-9]+\]:.*Invalid\ user[[:space:]]+[^[:space:]]+[[:space:]]+from[[:space:]]+[0-9A-Fa-f:.]+ ]] || continue
                [[ "$event" =~ ^([A-Z][a-z]{2})[[:space:]]+([0-9]{1,2})[[:space:]]+([0-9]{2}:[0-9]{2}:[0-9]{2}) ]] || continue
                month="${BASH_REMATCH[1]}"
                day="${BASH_REMATCH[2]}"
                clock="${BASH_REMATCH[3]}"
                printf -v day '%02d' "$day"
                case "$month" in
                    Jan) month_number=01 ;; Feb) month_number=02 ;; Mar) month_number=03 ;;
                    Apr) month_number=04 ;; May) month_number=05 ;; Jun) month_number=06 ;;
                    Jul) month_number=07 ;; Aug) month_number=08 ;; Sep) month_number=09 ;;
                    Oct) month_number=10 ;; Nov) month_number=11 ;; Dec) month_number=12 ;;
                    *) continue ;;
                esac

                nearest_epoch=''
                nearest_distance=''
                for candidate_year in "$((now_year - 1))" "$now_year" "$((now_year + 1))"; do
                    event_epoch=$(TZ=UTC0 LC_ALL=C date -u -d "${candidate_year}-${month_number}-${day}T${clock}Z" '+%s' 2>/dev/null) || continue
                    round_trip=$(TZ=UTC0 LC_ALL=C date -u -d "@$event_epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) || continue
                    [[ "$round_trip" == "${candidate_year}-${month_number}-${day}T${clock}Z" ]] || continue
                    distance=$((event_epoch - now_epoch))
                    (( distance < 0 )) && distance=$((-distance))
                    if [[ -z "$nearest_distance" ]] || (( distance < nearest_distance )); then
                        nearest_epoch="$event_epoch"
                        nearest_distance="$distance"
                    fi
                done
                [[ -n "$nearest_epoch" ]] || continue

                _s9_claim_matches_event "$claim_epoch" "$nearest_epoch" "$tol" "$allow_shift" && return 0
            done < <(grep -hiE 'invalid user' "$authlog" 2>/dev/null | grep -iE 'from ')
        done < <(grep -iE 'rule[^0-9]{0,15}5710([^0-9]|$)' <<< "$line" | grep -Eo "$timestamp_re")
    done < "$timeline"

    return 1
}

# Scenario 9: SIEM Alert Triage (Wazuh)
# Scenario 9: SIEM Alert Triage — student writes artifacts on meta (portal meta tab).
# SCENARIO_TARGETS[9]=meta.
#
# Diagnostics (instructor-only): before the PASS/FAIL token each milestone prints
#   DIAG reason=<CODE> location=<LOC> copies=<N>
# Callers read only the last stdout line, so the token contract is unchanged.
# CODE is from the fixed set below and LOC is a fixed location name -- never a
# file's contents, a student-chosen path, or command output. NONE = passed.
#   ARTIFACT_MISSING ARTIFACT_UNREADABLE ARTIFACT_INVALID PLACEHOLDER_OR_EXAMPLE
#   AGENT_MISSING AGENT_MISMATCH RULE_MISSING RULE_MISMATCH
#   TIMESTAMP_MISSING TIMESTAMP_NOT_MATCHED REPORT_TOO_SHORT REPORT_BODY_TOO_SHORT
#   CHECK_ERROR
# Each _s9_mN_reason runs the same predicates in the same order as the old
# single && chain and names the first one that fails, so PASS/FAIL is unchanged.

_S9_TIMESTAMP_RE='20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?Z'

# Pick one artifact. The guide's /home/msfadmin wins, so a stale /tmp copy can't
# override the file the student just edited; /home/student and /tmp still count
# when the guide path has none. Sets S9_SEL_PATH / S9_SEL_LOC / S9_SEL_COPIES
# (how many supported locations hold the name). S9_ARTIFACT_ROOT is a test seam
# only (prefix for all three locations, like S9_AUTHLOG / S9_NOW).
_s9_select_artifact() {
    local name="$1" root="${S9_ARTIFACT_ROOT:-}" entry dir loc
    S9_SEL_PATH=""
    S9_SEL_LOC="NONE"
    S9_SEL_COPIES=0
    for entry in "home/msfadmin:HOME_MSFADMIN" "home/student:HOME_STUDENT" "tmp:TMP"; do
        dir="${root}/${entry%%:*}"
        loc="${entry##*:}"
        [[ -f "$dir/$name" ]] || continue
        S9_SEL_COPIES=$((S9_SEL_COPIES + 1))
        if [[ -z "$S9_SEL_PATH" ]]; then
            S9_SEL_PATH="$dir/$name"
            S9_SEL_LOC="$loc"
        fi
    done
}

# Same auth.log lookup the timestamp checks use; empty when there is none.
_s9_authlog_path() {
    local f
    if [[ -n "${S9_AUTHLOG:-}" ]]; then
        [[ -f "$S9_AUTHLOG" ]] && printf '%s\n' "$S9_AUTHLOG"
        return 0
    fi
    for f in /var/log/auth.log /var/log/secure; do
        if [[ -f "$f" ]]; then printf '%s\n' "$f"; return 0; fi
    done
    return 0
}

# The lines the scorer's `while read` loops see (M1 agent, M2 timeline). A last
# line with no trailing newline is skipped there, so the diagnostics skip it too
# and report what the scorer saw, not what the file holds.
_s9_scorer_lines() {
    local line
    while IFS= read -r line; do printf '%s\n' "$line"; done < "$1"
}

# Does any line the scorer sees match ERE $2? No pipe into grep -q: under
# pipefail, grep -q exiting on the first match SIGPIPEs the writer on a large
# file (status 141) and the pipeline would report "no match".
_s9_scorer_lines_match() {
    local lines
    lines=$(_s9_scorer_lines "$1" 2>/dev/null) || return 1
    grep -qE "$2" <<< "$lines"
}

# Diagnostic only: names some pod-…-meta agent (M1 field form), even a wrong one.
_s9_names_any_meta_agent_field() {
    _s9_scorer_lines_match "$1" '[Aa]gent[^[:alnum:]]+"?pod-[A-Za-z0-9][A-Za-z0-9-]*-meta'
}

# Diagnostic only: names some pod-…-meta host anywhere (M3 prose form).
_s9_names_any_meta_agent() {
    grep -qiE 'pod-[a-z0-9][a-z0-9-]*-meta' "$1" 2>/dev/null
}

# Diagnostic only: gives some rule number, just not 5710.
_s9_names_other_rule() {
    grep -qiE 'rule[^0-9]{0,15}[0-9]{3,6}' "$1" 2>/dev/null
}

_s9_has_any_timestamp() {
    grep -qE "$_S9_TIMESTAMP_RE" "$1" 2>/dev/null
}

# Diagnostic only (M2): the timeline lines _s9_timeline_time_is_real reads, with
# its exact filter -- "rule"/"Rule" only, so "RULE 5710" is not a rule line.
_S9_TIMELINE_RULE_RE='[Rr]ule[^0-9]{0,15}5710([^0-9]|$)'

_s9_timeline_has_rule_line() {
    _s9_scorer_lines_match "$1" "$_S9_TIMELINE_RULE_RE"
}

_s9_timeline_names_other_rule() {
    _s9_scorer_lines_match "$1" '[Rr]ule[^0-9]{0,15}[0-9]{3,6}'
}

# Diagnostic only: some rule-5710 line in the timeline carries an ISO …Z stamp.
_s9_rule_line_has_timestamp() {
    local lines
    lines=$(_s9_scorer_lines "$1" 2>/dev/null) || return 1
    lines=$(grep -E "$_S9_TIMELINE_RULE_RE" <<< "$lines") || return 1
    grep -qE "$_S9_TIMESTAMP_RE" <<< "$lines"
}

_s9_m1_reason() {
    local f="$1"
    [[ -n "$f" ]] || { echo ARTIFACT_MISSING; return 0; }
    [[ -r "$f" ]] || { echo ARTIFACT_UNREADABLE; return 0; }
    grep -qiE "alert_id|severity|rule" "$f" 2>/dev/null || { echo ARTIFACT_INVALID; return 0; }
    if _s9_contains_unfilled_tokens "$f" || _s9_contains_guide_fiction "$f"; then
        echo PLACEHOLDER_OR_EXAMPLE; return 0
    fi
    if ! _s9_has_lab_meta_agent "$f"; then
        if ! _s9_expected_agent >/dev/null; then echo CHECK_ERROR
        elif _s9_names_any_meta_agent_field "$f"; then echo AGENT_MISMATCH
        else echo AGENT_MISSING
        fi
        return 0
    fi
    if ! _s9_mentions_rule_5710 "$f"; then
        if _s9_names_other_rule "$f"; then echo RULE_MISMATCH; else echo RULE_MISSING; fi
        return 0
    fi
    if ! _s9_has_real_event_timestamp "$f" 5; then
        if [[ -z "$(_s9_authlog_path)" ]]; then echo CHECK_ERROR
        elif _s9_has_any_timestamp "$f"; then echo TIMESTAMP_NOT_MATCHED
        else echo TIMESTAMP_MISSING
        fi
        return 0
    fi
    echo NONE
}

_s9_m2_reason() {
    local f="$1"
    [[ -n "$f" ]] || { echo ARTIFACT_MISSING; return 0; }
    [[ -r "$f" ]] || { echo ARTIFACT_UNREADABLE; return 0; }
    if _s9_contains_unfilled_tokens "$f" || _s9_contains_guide_fiction "$f"; then
        echo PLACEHOLDER_OR_EXAMPLE; return 0
    fi
    if ! _s9_timeline_time_is_real "$f" 5; then
        # The timeline check only reads timestamps on a "rule … 5710" line.
        if [[ -z "$(_s9_authlog_path)" ]]; then echo CHECK_ERROR
        elif ! _s9_timeline_has_rule_line "$f"; then
            if _s9_timeline_names_other_rule "$f"; then echo RULE_MISMATCH; else echo RULE_MISSING; fi
        elif _s9_rule_line_has_timestamp "$f"; then echo TIMESTAMP_NOT_MATCHED
        else echo TIMESTAMP_MISSING
        fi
        return 0
    fi
    echo NONE
}

_s9_m3_reason() {
    local f="$1"
    [[ -n "$f" ]] || { echo ARTIFACT_MISSING; return 0; }
    [[ -r "$f" ]] || { echo ARTIFACT_UNREADABLE; return 0; }
    [[ $(wc -c < "$f") -gt 200 ]] || { echo REPORT_TOO_SHORT; return 0; }
    grep -qiE "system|attack|alert|recommend" "$f" 2>/dev/null || { echo ARTIFACT_INVALID; return 0; }
    if _s9_contains_guide_fiction "$f" || _s9_looks_like_example_report "$f"; then
        echo PLACEHOLDER_OR_EXAMPLE; return 0
    fi
    [[ $(_s9_report_body_bytes "$f") -ge 120 ]] || { echo REPORT_BODY_TOO_SHORT; return 0; }
    if ! _s9_mentions_rule_5710 "$f"; then
        if _s9_names_other_rule "$f"; then echo RULE_MISMATCH; else echo RULE_MISSING; fi
        return 0
    fi
    if ! _s9_report_names_expected_agent "$f"; then
        if ! _s9_expected_agent >/dev/null; then echo CHECK_ERROR
        elif _s9_names_any_meta_agent "$f"; then echo AGENT_MISMATCH
        else echo AGENT_MISSING
        fi
        return 0
    fi
    echo NONE
}

check_scenario_9() {
    local milestone=$1 name reason
    case $milestone in
        1) name=alert_triage.json ;;
        2) name=incident_timeline.md ;;
        3) name=incident_report.txt ;;
        *) return ;;
    esac
    _s9_select_artifact "$name"
    reason=$("_s9_m${milestone}_reason" "$S9_SEL_PATH") || reason=CHECK_ERROR
    [[ -n "$reason" ]] || reason=CHECK_ERROR
    printf 'DIAG reason=%s location=%s copies=%s\n' "$reason" "$S9_SEL_LOC" "$S9_SEL_COPIES"
    if [[ "$reason" == NONE ]]; then echo "PASS"; else echo "FAIL"; fi
}

# Scenario 10: Full Attack Chain (Red vs Blue)
check_scenario_10() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Shell obtained
            if check_behavior "ssh.*@10\.0\.[0-9]+\.(20|30)|nc.*10\.0\.[0-9]+\.(20|30)|msfconsole.*exploit"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/shell_proof.txt ]] && (grep -q "uid=" /tmp/shell_proof.txt || grep -q "user=" /tmp/shell_proof.txt); then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        2)
            # M2: Privilege escalated
            if check_behavior "sudo -i|su -|./exploit"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/escalation_proof.txt ]] && grep -q "uid=0(root)" /tmp/escalation_proof.txt 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        3)
            # M3: Persistence installed
            if check_behavior "systemctl enable|crontab -e|authorized_keys"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /etc/systemd/system/backdoor.service ]] || (crontab -l 2>/dev/null | grep -qiE "bash|sh") || [[ $(wc -l < /root/.ssh/authorized_keys 2>/dev/null) -gt 1 ]]; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        4)
            # M4: Lateral movement attempted
            if check_behavior "nmap.*10\.0\.10|ssh.*10\.0\.10"; then echo "PASS"; return; fi
            # Fallback
            if [[ -f /tmp/lateral_attempt.txt ]] && (grep -qi "blocked\|filtered\|denied" /tmp/lateral_attempt.txt || grep -q "10.0.10" /tmp/lateral_attempt.txt); then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
    esac
}

# Scenario 11: Vulnerability Hardening (meta target; defender perspective)
check_scenario_11() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Identify the weakness (default Tomcat manager credential).
            # BEHAVIOR-ONLY: the default credential is baked into tomcat-users.xml
            # at golden-image build time (meta_install_tomcat.sh). The file is
            # root-owned, so as msfadmin it can only be read WITH sudo -- a plain
            # `cat` returns "Permission denied" and never shows the credential.
            # Require sudo so the credited command actually reveals the weakness
            # (previously a denied `cat` still passed -- false positive).
            if check_behavior "sudo[^|]*tomcat-users"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        2)
            # M2: Apply the remediation. nano/vim deliberately NOT in behavior
            # (would false-pass after M1 inspect-only). Prefer state of file.
            # Optional: bare systemctl restart can soft-pass; state check is authority.
            # TOMCAT_USERS_FILE is a test hook only; production never sets it.
            # Match either quote style: XML allows password='tomcat' too, and
            # just swapping the quotes must not count as a remediation.
            local users_file="${TOMCAT_USERS_FILE:-/etc/tomcat9/tomcat-users.xml}"
            if [[ -f "$users_file" ]]; then
                # The file's state decides. Previously a `sed -i` on the file
                # passed even when the default password was still there.
                if ! grep -qE "password=[\"']tomcat[\"']" "$users_file" 2>/dev/null; then
                    echo "PASS"
                else
                    echo "FAIL"
                fi
                return
            fi
            # No file to inspect (moved/renamed): fall back to the behavior trail.
            if check_behavior "sed -i.*tomcat-users"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        3)
            # M3: Confirm the exploit path is closed. This is the "confirm" step,
            # so BOTH must hold:
            #  (a) STATE  -- the manager now rejects the OLD tomcat:tomcat creds
            #      with 401/403 (the fix is really in place), and
            #  (b) BEHAVIOR -- the student actually ran the verification: a curl
            #      to the Tomcat manager with the old creds appears in history.
            # State alone became true the moment M2 rotated the password, so the
            # task scored without the student doing it (3/3 after only M1+M2);
            # requiring the curl in history fixes that false auto-pass.
            local code
            code=$(curl -s -o /dev/null -w '%{http_code}' -u tomcat:tomcat http://127.0.0.1:8180/manager/text/list 2>/dev/null || echo "000")
            if { [[ "$code" == "401" || "$code" == "403" ]]; } \
                && check_behavior "curl.*(8180|manager).*tomcat:tomcat|curl.*tomcat:tomcat.*(8180|manager)"; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
    esac
}

# Default fallback (should not be reached for defined scenarios)
check_scenario_default() {
    local scenario=$1
    local milestone=$2
    log "Scenario $scenario, Milestone $milestone: check not yet defined"
    echo "UNKNOWN"
}

# === EXECUTION ===
case $SCENARIO_ID in
    1) check_scenario_1 "$MILESTONE_ID" ;;
    2) check_scenario_2 "$MILESTONE_ID" ;;
    3) check_scenario_3 "$MILESTONE_ID" ;;
    4) check_scenario_4 "$MILESTONE_ID" ;;
    5) check_scenario_5 "$MILESTONE_ID" ;;
    6) check_scenario_6 "$MILESTONE_ID" ;;
    7) check_scenario_7 "$MILESTONE_ID" ;;
    8) check_scenario_8 "$MILESTONE_ID" ;;
    9) check_scenario_9 "$MILESTONE_ID" ;;
    10) check_scenario_10 "$MILESTONE_ID" ;;
    11) check_scenario_11 "$MILESTONE_ID" ;;
    *) check_scenario_default "$SCENARIO_ID" "$MILESTONE_ID" ;;
esac

exit 0
