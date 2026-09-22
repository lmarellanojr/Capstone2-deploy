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
    [[ -z "$prefix" ]] && log "WARN: no IPv4 on eth0; scenario 1 checks will FAIL"
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
            # checked via msf console history on kali — SCENARIO_TARGETS[1]=kali)
            if check_msf_history "tomcat_mgr_deploy|exploit/multi/http/tomcat_mgr_deploy"; then echo "PASS"; return; fi
            if check_behavior "tomcat_mgr_deploy|msfconsole.*tomcat"; then echo "PASS"; return; fi
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

# Scenario 6: SQL Injection (DVWA target)
# Scenario 6: SQL Injection — checked on KALI (attacker history + optional flag file).
# SCENARIO_TARGETS[6]=kali. Browser SQLi hits DVWA; sqlmap runs from Kali.
check_scenario_6() {
    local milestone=$1
    case $milestone in
        1)
            # M1: Injection point found (manual OR payload or equivalent)
            if check_behavior "1' OR '1'='1|1' or '1'='1|OR 1=1|or 1=1"; then echo "PASS"; return; fi
            if check_behavior "curl.*dvwa.*id=|curl.*vulnerabilities/sqli"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        2)
            # M2: Database / users extraction (UNION or dump evidence)
            if check_behavior "UNION SELECT|union select|information_schema|FROM users"; then echo "PASS"; return; fi
            if [[ -f /tmp/sqli_users.txt ]] && [[ -s /tmp/sqli_users.txt ]]; then
                echo "PASS"
                return
            fi
            echo "FAIL"
            ;;
        3)
            # M3: Admin hash captured via sqlmap dump or written artifact
            if check_behavior "sqlmap.*--dump|sqlmap.*-T users|sqlmap.*--tables"; then echo "PASS"; return; fi
            if [[ -f /tmp/admin_hash.txt ]] && [[ -s /tmp/admin_hash.txt ]]; then
                echo "PASS"
                return
            fi
            if [[ -f /tmp/sqlmap_output.txt ]] && [[ -s /tmp/sqlmap_output.txt ]]; then
                echo "PASS"
                return
            fi
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
            # M2: Timeline / true-positive classification
            if [[ -n "$timeline" ]] && grep -qE "^#|^-|^[0-9]+\.|rule|phase" "$timeline" 2>/dev/null; then
                echo "PASS"
                return
            fi
            if [[ -n "$triage" ]] && grep -qiE "true.?positive|\"TP\"|real" "$triage" 2>/dev/null; then
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
            # Deliberately BEHAVIOR-ONLY: default credential is baked into
            # tomcat-users.xml at golden-image build time (meta_install_tomcat.sh).
            if check_behavior "cat.*tomcat-users|grep.*tomcat-users|nano.*tomcat-users|vim.*tomcat-users|less.*tomcat-users"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        2)
            # M2: Apply the remediation. nano/vim deliberately NOT in behavior
            # (would false-pass after M1 inspect-only). Prefer state of file.
            # Optional: bare systemctl restart can soft-pass; state check is authority.
            if [[ -f /etc/tomcat9/tomcat-users.xml ]] && ! grep -q 'password="tomcat"' /etc/tomcat9/tomcat-users.xml 2>/dev/null; then
                echo "PASS"
                return
            fi
            if check_behavior "sed -i.*tomcat-users"; then echo "PASS"; return; fi
            echo "FAIL"
            ;;
        3)
            # M3: Confirm the exploit path is closed (401 or 403).
            local code
            code=$(curl -s -o /dev/null -w '%{http_code}' -u tomcat:tomcat http://127.0.0.1:8180/manager/text/list 2>/dev/null || echo "000")
            if [[ "$code" == "401" || "$code" == "403" ]]; then
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
