# WAZUH-API (#286) — API loopback bind & built-in credential rotation

**Issue:** [#286](https://github.com/lmarellanojr/Capstone2-deploy/issues/286)
**Owner:** Lenie Joice Mendoza (@leniejoice)
**Host deployment:** Leonardo (applies `harden_wazuh_api.sh` per host, records service recovery)
**Testing partner:** Shekinah Jabez Florentino (independently verifies the owner's security change)
**Host-deployment verifier:** Maricar (verifies Leonardo's host deployment)
**Status:** **Pending** — no check below has been executed. Fill in **as you go**; paste real
output, do not retype. A gate with no output pasted is **NOT VERIFIED**, not PASS. Record
dates in Asia/Manila. This is post-UAT regression evidence, kept separate from original UAT;
do not run against a live host until baseline preservation (#283) is complete.

> **Do not paste any password, token, or secret value into this file.** Record *that* a
> credential was rotated and *that* a check passed — never the value.

---

## Per-host record

Copy this block once per host (Ampere / second host / any future host).

### Host: `<name / public IP>`

| Field | Value |
|---|---|
| Date (Asia/Manila) | _Pending_ |
| Product commit (`~/cyberrange`) | _Pending_ |
| Manual commit | _Pending_ |
| Applied by | _Pending_ |
| Verdict | **PASS / FAIL / PARTIAL — Pending** |

| # | Gate | Expected | Result |
|---|---|---|---|
| 1 | Listener **before** change | record what `:55000` was bound to | _Pending_ |
| 2 | Listener **after** change | only `127.0.0.1:55000` (never `0.0.0.0`/`10.0.40.10`) | _Pending_ |
| 3 | Authorized local login | new `wazuh` password → token (HTTP 200) via `https://localhost:55000` | _Pending_ |
| 4 | Old `wazuh` rejected | previous/default `wazuh` password → HTTP 401 | _Pending_ |
| 5 | `wazuh-wui` rotated | new password → 200; default `wazuh-wui:wazuh-wui` → 401 | _Pending_ |
| 6 | Pod → API denied | from a disposable pod, `https://10.0.40.10:55000` is refused/times out | _Pending_ |
| 7 | `scoring` still works | read-only `scoring` token still authenticates; `GET /agents` 200 | _Pending_ |
| 8 | `provisioner` still works | `provisioner` token authenticates; cleanup path unaffected | _Pending_ |
| 9 | Fresh provision/enrollment | a disposable pod provisions, its agent enrolls over 1514/1515 | _Pending_ |
| 10 | SIEM alert delivery | that disposable pod's alert reaches the manager | _Pending_ |

#### Output

```text
<paste the command output backing each gate above; no secret values>
```

#### Commands used

```bash
# 1–2  listener before/after (the script prints both; this is the manual check)
lxc exec wazuh-manager -- ss -ltnp | grep 55000

# 3–5  rotation (the script does this and prints only pass/fail, never a value)
read -rs WAZUH_ADMIN_PW; export WAZUH_ADMIN_PW
~/cyberrange/deploy/host/harden_wazuh_api.sh
unset WAZUH_ADMIN_PW

# 6    pod-to-API denial (run from inside a disposable pod)
curl -sk --max-time 5 https://10.0.40.10:55000/ ; echo "exit=$?"   # expect refused/timeout

# 7–10 regression: scoring/provisioner tokens, fresh disposable provision/enrollment/alert
```

#### Deviations / notes

_Pending — anything that differed from Manual 02 Step 4d / Manual 06 Step 2._

---

## Testing-partner findings (Shekinah)

_Pending — independent reproduction of gates 2–5 (listener + rotation), with date/build,
expected vs actual, and any defects._

## Host-deployment verification (Maricar)

_Pending — confirmation of Leonardo's per-host application and service recovery._

## Follow-up evaluation decision

_Pending — any material effect on the evaluated journey or scoring. New results stay
separate from original UAT; no historical rescoring._
