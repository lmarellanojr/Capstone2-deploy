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
check_live_tomcat_msf_session() {
    local prefix="$1"
    [[ -n "$prefix" ]] || return 1
    local target="${prefix}.20"
    local pane_info pane_output socket_output pane_pid pane_cmd msf_pid msf_cmdline session_peer

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
    [[ $(printf '%s\n' "$pane_info" | grep -c .) -eq 1 ]] || return 1
    IFS='|' read -r pane_pid pane_cmd <<< "$pane_info"
    [[ "$pane_pid" =~ ^[0-9]+$ ]] || return 1
    [[ "$pane_cmd" =~ ^(ruby|msfconsole)$ ]] || return 1

    # Arm only on an explicit run/exploit at the Tomcat module prompt. Any other
    # Metasploit prompt clears arming, so an echo entered after module selection
    # cannot forge the session-open event. Pane text itself remains untrusted;
    # the strict full-prompt spoof regression tracks the RPC provenance gap.
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
check_scenario_1() {
    local milestone=$1
    local prefix esc
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
            if [[ -n "$prefix" ]] && check_behavior "nmap.*${esc}\.0/24" && has_subnet_route; then
              echo "PASS"; return
            fi
            echo "FAIL"
            ;;
        2)
            # M2: Port Enumeration — prefer -p / -F / port list against this
            # pod's actual meta/dvwa host (.20/.30), not any pod's. The old
            # fallback "nmap.*-p |nmap -F " required no target at all (any
            # -p/-F scan of anything passed) -- dropped rather than tightened,
            # since a port scan of the wrong host isn't port enumeration of
            # the target.
            if [[ -z "$prefix" ]] || ! has_subnet_route; then echo "FAIL"; return; fi
            if check_behavior "nmap.*(-p|-F).*${esc}\.(20|30)|nmap.*${esc}\.(20|30).*(-p|-F)"; then
              echo "PASS"; return
            fi
            echo "FAIL"
            ;;
        3)
            # M3: Service Version Detection (nmap -sV against this pod's real
            # victim host). Old pattern "nmap.*-sV" matched -sV anywhere in
            # history regardless of target, so a scan against a mistyped/
            # nonexistent IP (10.0.51.19 when meta is .20) or even another
            # pod's subnet still credited full points despite nmap itself
            # reporting 0 hosts up. Anchor to THIS pod's actual victim IPs,
            # in either flag/IP order a student might type.
            if [[ -n "$prefix" ]] && check_behavior "nmap.*-sV.*${esc}\.(20|30)|nmap.*${esc}\.(20|30).*-sV" && has_subnet_route; then
              echo "PASS"; return
            fi
            echo "FAIL"
            ;;
        4)
            # M4: Exploit Tomcat manager on the meta target (merged from scenario 3;
            # require a live target-correlated Metasploit session on Kali.)
            if check_live_tomcat_msf_session "$prefix"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
    esac
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

# Scenario 9 M2 helper: is a time claimed in the timeline a REAL rule-5710 SSH
# event (sshd "Invalid user" / failed login as a non-existent user) from
# auth.log, within +/- $2 minutes, on a line that also carries a rule id?
#
# SCORE-FIX (Scenario 3 / scenario_id 9, Task 2 "True Positive Classification"):
# the old check passed on ANY well-formed HH:MM that was not the literal
# placeholder, so a fabricated/incorrect time (e.g. 00:00) scored. The claimed
# time must now match a real detected event, so wrong/empty/malformed times fail.
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

    # Real event minutes-of-day (0..1439) from invalid-user SSH lines (rule 5710).
    local real_minutes
    real_minutes=$(grep -hiE "invalid user|failed password for invalid user" "$authlog" 2>/dev/null \
        | grep -oE "[0-9]{2}:[0-9]{2}:[0-9]{2}" \
        | awk -F: '{print ($1*60)+$2}' | sort -un)
    [[ -z "$real_minutes" ]] && return 1

    # Claimed times: lines carrying a rule id AND an HH:MM (placeholder excluded).
    local claimed_minutes
    claimed_minutes=$(grep -iE "rule[^0-9]{0,15}[0-9]{3,6}" "$timeline" 2>/dev/null \
        | grep -oE "[0-9]{1,2}:[0-9]{2}" | grep -v "HH:MM" \
        | awk -F: '{h=$1+0; m=$2+0; if (h<24 && m<60) print (h*60)+m}')
    [[ -z "$claimed_minutes" ]] && return 1

    # PASS if any claimed minute matches any real event minute within +/- tol,
    # EITHER as an absolute time (same timezone) OR as the same minutes-past-the-
    # hour (a whole-hour timezone offset). The meta container logs in UTC, but the
    # SIEM and the student's browser often show local time (e.g. UTC+8), so a
    # correct event copied from the SIEM is hours off from auth.log yet shares the
    # minutes. Matching minutes-of-hour accepts that real time while still
    # rejecting fabricated/placeholder times (e.g. 00:00) and empty times.
    awk -v tol="$tol" '
        NR==FNR { real[$1]=1; next }
        {
            for (r in real) {
                d=$1-r; if (d<0) d=-d;
                if (d<=tol) { found=1; exit }        # same-timezone exact match
                md=($1 % 60) - (r % 60); if (md<0) md=-md;
                if (md>30) md=60-md;                 # wrap across the hour boundary
                if (md<=tol) { found=1; exit }       # whole-hour timezone offset
            }
        }
        END { exit(found?0:1) }
    ' <(printf "%s\n" $real_minutes) <(printf "%s\n" $claimed_minutes)
}

# Scenario 9: SIEM Alert Triage (Wazuh)
# Scenario 9: SIEM Alert Triage — student writes artifacts on meta (portal meta tab).
# SCENARIO_TARGETS[9]=meta. Accept /tmp or /home/msfadmin paths.
check_scenario_9() {
    local milestone=$1
    local triage="" timeline="" report="" d
    for d in /tmp /home/msfadmin /home/student; do
        if [[ -z "$triage" && -f "$d/alert_triage.json" ]]; then triage="$d/alert_triage.json"; fi
        if [[ -z "$timeline" && -f "$d/incident_timeline.md" ]]; then timeline="$d/incident_timeline.md"; fi
        if [[ -z "$report" && -f "$d/incident_report.txt" ]]; then report="$d/incident_report.txt"; fi
    done
    case $milestone in
        1)
            # M1: Started triage — structured file with rule/severity fields
            if [[ -n "$triage" ]] && grep -qiE "alert_id|severity|rule" "$triage" 2>/dev/null; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
        2)
            # M2: Timeline / true-positive classification.
            # The guide's template already has headings, "rule" and "phase" on
            # every line, so structure alone can't earn the points. One timeline
            # line must carry a rule ID AND a clock time that matches a REAL
            # rule-5710 SSH event from auth.log within +/-5 minutes -- a
            # fabricated/incorrect or placeholder time no longer passes.
            if [[ -n "$timeline" ]] && _s9_timeline_time_is_real "$timeline" 5; then
                echo "PASS"
                return
            fi
            # Triage TP path: the M1 triage template's placeholders mean it wasn't filled in.
            if [[ -n "$triage" ]] && grep -qiE "true.?positive|\"TP\"|real" "$triage" 2>/dev/null \
                && ! grep -qE "example-1|pod-STUDENT-meta|Replace fields with" "$triage" 2>/dev/null; then
                echo "PASS"
                return
            fi
            echo "FAIL"
            ;;
        3)
            # M3: Incident summary (structured, >200 bytes, key terms)
            if [[ -n "$report" ]] && [[ $(wc -c < "$report") -gt 200 ]] && grep -qiE "system|attack|alert|recommend" "$report"; then
                echo "PASS"
            else
                echo "FAIL"
            fi
            ;;
    esac
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
