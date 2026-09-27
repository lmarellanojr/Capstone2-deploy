import os
import re
import json
import pylxd
from collections import deque
import requests
from datetime import datetime, timedelta, timezone
import urllib3

# Suppress insecure request warnings for local Wazuh API
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Env comes from the process environment (systemd EnvironmentFile= / shell
# export), same as every other module in this tree -- config.py, auth.py,
# wazuh_client.py all read os.getenv() directly with no dotenv layer.
# load_dotenv() was redundant once the API is started with a real
# environment, and it pulled in a dependency (python-dotenv) the unified
# tree never declared, so score_verifier -- and everything downstream of it
# in load_scoring_modules() -- silently failed to import wherever dotenv
# wasn't installed (branch-review Issue 7 follow-up).
WAZUH_USER = os.getenv('WAZUH_SCORING_USER')
WAZUH_PW = os.getenv('WAZUH_SCORING_PW')
# "localhost" matches the Wazuh API cert SAN (DNS:localhost, no IP SAN); the
# literal IP fails TLS hostname verification. See config.py for the full note.
WAZUH_URL = os.getenv('WAZUH_API_URL', 'https://localhost:55000')
cert_env = os.getenv('WAZUH_CERT_PATH')
WAZUH_CERT = True if cert_env in ['True', 'true', '1'] else False  # Explicit cast to prevent literal string crashes
LXD_PROJECT = os.getenv('LXD_PROJECT', 'default')

# S2 auto-detect: read the manager's alerts.json over the LXD control plane.
# Wazuh 4.7 has no manager-API /alerts endpoint and the indexer (:9200) is not
# running here, so the manager's JSON alert log is the source of truth. The
# manager is trusted infra (not student-controlled), so this is tamper-sound.
WAZUH_MANAGER_INSTANCE = os.getenv('WAZUH_MANAGER_INSTANCE', 'wazuh-manager')
ALERTS_JSON_PATH = '/var/ossec/logs/alerts/alerts.json'
_ALERTS_MAX_BYTES = 64 * 1024 * 1024     # cap so a verify call can't OOM the worker


def _parse_wazuh_ts(ts):
    # Wazuh emits "2026-06-21T10:19:54.479+0000" (no colon in the offset);
    # Python 3.10 datetime.fromisoformat needs "+00:00". Normalize first.
    ts = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(re.sub(r'([+-]\d{2})(\d{2})$', r'\1:\2', ts))

def verify_artifact_flag(instance_name, filepath, expected_string):
    """
    Securely reads a file from the container's filesystem using the LXD socket.
    Does NOT execute shell commands, preventing student binary hooking.
    """
    client = pylxd.Client(project=LXD_PROJECT)
    try:
        instance = client.instances.get(instance_name)
        
        if instance.status != 'Running':
            print(f"[{instance_name}] Error: Container is not running (Status: {instance.status})")
            return False

        # Natively clip the payload at the container source by bypassing the pylxd wrapper
        # and streaming the raw REST API response directly.
        res = client.api.instances[instance_name].files.get(params={'path': filepath}, stream=True)
        
        # Pull only the first 128 bytes natively in Python to completely neutralize /dev/zero memory bombs
        # without invoking any guest binaries like /usr/bin/head (which neutralizes binary hooking exploits)
        content = next(res.iter_content(chunk_size=128), b"")
        text_content = content.decode('utf-8', errors='ignore')
        
        if expected_string in text_content:
            print(f"[{instance_name}] Success: Found flag '{expected_string}' in {filepath}")
            return True
        else:
            print(f"[{instance_name}] Failed: Flag not found.")
            return False
            
    except pylxd.exceptions.NotFound:
        print(f"[{instance_name}] Error: File {filepath} or instance not found.")
        return False
    except Exception as e:
        print(f"[{instance_name}] Error accessing filesystem: {e}")
        return False

def verify_siem_alert(agent_id, rule_id, since_minutes=240):
    """
    True if rule_id fired for agent_id within since_minutes, per the manager's
    alerts.json, read over the LXD control plane (no Wazuh API/indexer/creds).
    The manager is trusted infra; this is the agentless, tamper-sound signal.
    Default window (240m) covers a lab session so a late verify still credits a
    real detection. Keeps only the newest _ALERTS_MAX_BYTES of the file: the
    alerts we want are at the end, and reading from the start stopped at the
    cap before reaching them once alerts.json grew past 64 MiB (SIEM-SCOPE).
    """
    agent_id = str(agent_id).zfill(3)        # alerts.json stores zero-padded ids
    rule_id = str(rule_id)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
    client = pylxd.Client(project=LXD_PROJECT)
    try:
        res = client.api.instances[WAZUH_MANAGER_INSTANCE].files.get(
            params={'path': ALERTS_JSON_PATH}, stream=True)
        chunks, size, truncated = deque(), 0, False
        for chunk in res.iter_content(chunk_size=65536):
            chunks.append(chunk)
            size += len(chunk)
            while size - len(chunks[0]) >= _ALERTS_MAX_BYTES:
                size -= len(chunks.popleft())
                truncated = True
        lines = b"".join(chunks).split(b"\n")
        if truncated:
            lines = lines[1:]                # drop the partial first line
        for raw in reversed(lines):          # newest first
            if b'"rule"' not in raw:
                continue
            try:
                ev = json.loads(raw)
                if str(ev.get('rule', {}).get('id')) != rule_id:
                    continue
                if str(ev.get('agent', {}).get('id')) != agent_id:
                    continue
                if _parse_wazuh_ts(ev.get('timestamp', '')) >= cutoff:
                    print(f"[Agent {agent_id}] Success: rule {rule_id} fired")
                    return True
            except (ValueError, KeyError):
                continue
        print(f"[Agent {agent_id}] Failed: rule {rule_id} not detected in window")
        return False
    except pylxd.exceptions.NotFound:
        print(f"alerts.json or instance {WAZUH_MANAGER_INSTANCE} not found")
        return False
    except Exception as e:
        print(f"Error reading alerts.json: {e}")
        return False

if __name__ == "__main__":
    print("--- Cyber Range Automated Scoring Engine ---")
    
    # Example 1: Verify Offensive Scenario Flag (Reading /root/flags/flag.txt from test-sudo)
    print("\n[+] Testing Artifact Verification...")
    verify_artifact_flag("test-sudo", "/root/flags/flag.txt", "FLAG{TEST_SUCCESS}")
    
    # Example 2: Verify Defensive Scenario SIEM Alert (Checking agent 005 for rule 5715)
    print("\n[+] Testing SIEM Alert Verification...")
    verify_siem_alert("005", "5715")
