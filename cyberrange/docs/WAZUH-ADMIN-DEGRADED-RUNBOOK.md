# Wazuh Admin tile Degraded — operator runbook

Use this when **Admin → System** shows **Wazuh = Degraded** (or Unavailable) on any Ampere / second-host domain (for example `cyberrange.bubble-express.win`, `cyberrange.cyberlaboratory.online`, or a new student domain).

This is **host configuration**, not a portal UI bug. Student labs and SIEM panes that read `alerts.json` via LXD can still work while this tile is Degraded.

Related: `ADM-SYS-02-keycloak-wazuh-health.md`, Manual `02-gateway-and-wazuh.md` §4e, Manual `06-scoring.md`, `cyberrange/certs/README.md`.

---

## What Healthy means

Wazuh is **Healthy** only when all of these are true:

1. `WAZUH_API_URL` points at the manager with the **hostname** form: `https://localhost:55000` (not `127.0.0.1`).
2. `WAZUH_SCORING_USER` and `WAZUH_SCORING_PW` are set in `~/cyberrange/env/.env`.
3. Those vars are loaded into the **running** `cyberrange-provision-api` process (`EnvironmentFile=`).
4. `WAZUH_CA_BUNDLE` (usually `~/cyberrange/certs/wazuh-api.crt`) **matches** the certificate the live manager presents.
5. The scoring user can authenticate and agent **000** reports `active`.

---

## Read the detail line first

| Detail (or close wording) | Meaning | Fix |
|---|---|---|
| Manager API reachable; scoring not configured | Manager answers; scoring user/password missing in the **API process** | Set creds in `.env`, restart API |
| scoring credentials not configured … manager API unreachable | Creds missing **and** manager not answering | Start/fix manager, then set creds |
| reachable, but TLS verification failed | Creds present; CA pin does not match live `server.crt` | Re-extract cert (§ below) |
| reachable, but the scoring credentials were rejected | Wrong user/password | Reset password / recreate scoring user (Manual 06) |
| scoring user cannot read agents | User exists but wrong/missing role | Attach readonly role (Manual 06 §1c) |
| manager agent reports disconnected / pending / … | Auth works; agent 000 not `active` | Fix manager agent status |
| Wazuh manager API unreachable / probe timed out | Network, LXD proxy, or manager down | Check `wazuh-manager`, port `55000` |

Hard-refresh the browser (Ctrl+Shift+R) after every fix so the Admin page is not showing a cached snapshot.

---

## Safety

- Do **not** paste `WAZUH_SCORING_PW` into chat, tickets, or screenshots.
- Do **not** set `WAZUH_TLS_VERIFY=false` to “make it green.” Fix the pin or the URL instead.
- Prefer `https://localhost:55000`. The API cert SAN is `DNS:localhost` only.
- Do **not** put the scoring password on a `curl` command line (`-u user:pass` shows up in `ps` and shell history).

---

## Step 0 — Shell env for user systemd

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=${XDG_RUNTIME_DIR}/bus
```

---

## Step 1 — Are scoring creds in `.env`?

```bash
set -a; source ~/cyberrange/env/.env; set +a
python3 - <<'PY'
import os
u=(os.getenv("WAZUH_SCORING_USER") or "").strip()
p=(os.getenv("WAZUH_SCORING_PW") or "").strip()
print("USER_SET=" + ("yes" if u else "no"))
print("PW_SET=" + ("yes" if p else "no"))
print("API_URL=" + (os.getenv("WAZUH_API_URL") or "(unset)"))
print("CA=" + (os.getenv("WAZUH_CA_BUNDLE") or "(unset)"))
print("TLS_VERIFY=" + (os.getenv("WAZUH_TLS_VERIFY") or "(unset)"))
PY
```

If `USER_SET=no` or `PW_SET=no`, wire Manual **06** (create read-only `scoring` user, write vars into `~/cyberrange/env/.env`), then:

```bash
systemctl --user restart cyberrange-provision-api
```

Minimum `.env` keys (values from Manual 06):

```bash
WAZUH_API_URL=https://localhost:55000
WAZUH_TLS_VERIFY=true
WAZUH_CA_BUNDLE=/home/<deploy-user>/cyberrange/certs/wazuh-api.crt
WAZUH_SCORING_USER=scoring
WAZUH_SCORING_PW=<password from Manual 06>
```

Replace `<deploy-user>` with the host deploy user (often `llms_admin` on Ampere).
systemd `EnvironmentFile=` does **not** expand `$HOME`; a literal `$HOME/...`
value breaks the running API pin path even when a shell `source` of the same
file looks fine.

---

## Step 2 — Does the **running API** see those vars?

Shell `source` can look fine while systemd still has empty values (restart skipped, or `EnvironmentFile` parse failure from quotes/`$` in the password).

```bash
PID=$(systemctl --user show -p MainPID --value cyberrange-provision-api)
echo "PID=$PID"
tr '\0' '\n' < /proc/$PID/environ \
  | grep -E '^WAZUH_(API_URL|SCORING_USER|SCORING_PW|CA_BUNDLE|TLS_VERIFY)=' \
  | sed -E 's/(WAZUH_SCORING_PW)=.*/\1=<set>/'
```

Expect `WAZUH_SCORING_USER` and `WAZUH_SCORING_PW=<set>` on the process. If missing: fix `.env` formatting, restart the unit, re-check.

---

## Step 3 — TLS pin: does `curl --cacert` authenticate?

Use a mode-0600 netrc so the password is not on argv, and a home-dir temp file for the JSON body:

```bash
set -a; source ~/cyberrange/env/.env; set +a
CA="${WAZUH_CA_BUNDLE:-$HOME/cyberrange/certs/wazuh-api.crt}"
ls -l "$CA" || echo CA_MISSING

umask 077
NETRC=$(mktemp "$HOME/cyberrange-data/wz-netrc.XXXXXX")
AUTH_JSON=$(mktemp "$HOME/cyberrange-data/wz-auth.XXXXXX.json")
cleanup() { rm -f "$NETRC" "$AUTH_JSON"; }
trap cleanup EXIT

printf 'machine localhost\nlogin %s\npassword %s\n' \
  "$WAZUH_SCORING_USER" "$WAZUH_SCORING_PW" > "$NETRC"
chmod 600 "$NETRC"

curl -sS -o "$AUTH_JSON" -w "auth_http=%{http_code} curl_exit=%{exitcode}\n" \
  --netrc-file "$NETRC" \
  --cacert "$CA" \
  -X GET "${WAZUH_API_URL}/security/user/authenticate" \
  || echo "curl_failed_exit=$?"

python3 - "$AUTH_JSON" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
raw = path.read_text() if path.exists() else ""
print("body_len=", len(raw))
try:
    d = json.loads(raw) if raw else {}
    print("token_ok=", "yes" if (d.get("data") or {}).get("token") else "no")
except Exception as e:
    print("json_err=", e)
PY
```

### `curl_exit=60` / SSL certificate problem

The file at `WAZUH_CA_BUNDLE` does **not** match the live manager certificate. Common causes:

- a fresh Wazuh install / cert regeneration on this host, or
- an older **branch bake / rsync** that copied the repo `certs/wazuh-api.crt` over the host pin (official `pull_release` now preserves an existing host pin; see below).

**Re-extract from the live manager** (Manual 02 §4e) — ops path **C**:

```bash
cp -a ~/cyberrange/certs/wazuh-api.crt \
  ~/cyberrange/certs/wazuh-api.crt.bak.$(date +%Y%m%d%H%M)

lxc exec wazuh-manager -- cat /var/ossec/api/configuration/ssl/server.crt \
  > ~/cyberrange/certs/wazuh-api.crt

openssl x509 -in ~/cyberrange/certs/wazuh-api.crt -noout -subject -dates
openssl x509 -in ~/cyberrange/certs/wazuh-api.crt -noout -text \
  | grep -A1 "Subject Alternative Name"
# expect: DNS:localhost
```

Re-run the `curl` auth test. Expect `auth_http=200` and `token_ok=yes`.

Then restart the API so clients re-read the CA file:

```bash
systemctl --user restart cyberrange-provision-api
sleep 3
curl -sS http://10.115.77.1:5000/health; echo
```

### `auth_http=401` or `403`

Credentials or role problem — Manual 06 Steps 1b–1d (recreate user, attach readonly role, confirm agent read works and admin create-user returns 403).

### `auth_http=200` but Admin still Degraded

Hard-refresh `/admin/system`. If detail mentions agent status, inspect agent 000 via the scoring token (Manual 06). If detail still says TLS failed, confirm `WAZUH_CA_BUNDLE` path inside the **process** environ matches the file you updated.

---

## Step 4 — Confirm on the domain

1. Open `https://<that-domain>/admin/system` as Admin.
2. Hard-refresh.
3. Expect Wazuh **Healthy** with detail about manager API authenticated / manager active.
4. API / LXD / Keycloak should remain Healthy independently.

---

## Branch bake and release notes (avoid re-breaking other domains)

### Manual rsync / side-clone bake

When syncing a feature branch onto a live tree, **exclude** the host pin (`release_sync` preserve does not apply to rsync):

```bash
rsync -a \
  --exclude 'certs/wazuh-api.crt' \
  --exclude '.venv/' \
  --exclude 'env/.env' \
  --exclude 'env/.env.*' \
  --exclude 'portal/.env' \
  --exclude 'portal/.env.local' \
  --exclude 'portal/.env.bridge' \
  --exclude 'portal/node_modules/' \
  --exclude 'portal/.next/' \
  --exclude 'DEPLOYED_SHA' \
  --exclude '.git/' \
  ~/src/<repo>/cyberrange/ ~/cyberrange/
```

Also stop `cyberrange-pull-release.timer` while testing a branch bake so ampere-live does not overwrite mid-test.

### Official `pull_release` / ampere-live

`release_sync.extract_tree` **preserves** an existing `certs/wazuh-api.crt` (exact relpath) so the tarball starter does not clobber a good host pin (#152 / #153).

**Auto-sync (#154):** after extract (and on SHA-unchanged skip), `pull_release.sh` runs `deploy/host/sync_wazuh_api_cert.py`. That helper copies `/var/ossec/api/configuration/ssl/server.crt` from the live `wazuh-manager` guest into `~/cyberrange/certs/wazuh-api.crt` only when:

- fingerprints match `localhost:55000`, and
- SAN includes `DNS:localhost`.

It backups the previous pin under `~/cyberrange-data/`. Failures are **non-fatal** to the pull (manager stopped → skip).

So for **all Ampere domains** with scoring creds already set:

1. Merge + Promote a release that includes #154.
2. Each host `pull_release` (timer or manual) → TLS pin heals → Admin Wazuh should leave `reachable, but TLS verification failed`.
3. Hard-refresh `/admin/system`.

One-shot without waiting for a SHA change (after the helper exists on the host):

```bash
python3 ~/cyberrange/deploy/host/sync_wazuh_api_cert.py --strict
# or, once the new pull_release.sh is present:
bash ~/cyberrange/deploy/host/pull_release.sh
```

After pull, optional hygiene:

1. Re-run the Step 3 auth test.
2. If `curl_exit=60` after auto-sync skipped (manager down), start `wazuh-manager` and re-run the helper, or follow path **C**.
3. To install a newer **git** starter onto a host that already has a pin (path **B**): follow `cyberrange/certs/README.md` path B. Auto-sync will overwrite that starter again from the live manager on the next pull if the manager is up.

Rollback uses the same `--extract` path, so preserve applies there too (host pin is not clobbered by a stale snapshotted pin). Auto-sync still runs after a successful apply restore path only when operators re-run pull; `--rollback` does not invoke sync.

---

## Quick checklist (copy onto a ticket)

- [ ] Domain name / host (`cyberrange-vnic` or other)
- [ ] Admin detail line (exact text)
- [ ] `USER_SET` / `PW_SET` from Step 1
- [ ] Process environ shows scoring vars (Step 2)
- [ ] `auth_http` / `token_ok` / `curl_exit` (Step 3) — **no password**
- [ ] Re-extracted cert? (yes/no)
- [ ] API restarted? (yes/no)
- [ ] Admin tile after hard-refresh

---

## Evidence from bubble-express (2026-10-02)

On `cyberrange.bubble-express.win` during a pre-merge bake of PR #141:

1. Tile showed scoring-not-configured / then TLS failure after creds were confirmed in `.env`.
2. Process environ had scoring user/password set; `WAZUH_API_URL=https://localhost:55000`.
3. `curl --cacert` returned **exit 60** (pinned `wazuh-api.crt` did not match live manager).
4. Re-extract from `wazuh-manager` → `auth_http=200`, `token_ok=yes` → API health ok → Admin Wazuh Healthy after refresh.

Root cause on that host: branch **rsync** had replaced the host pin with the repo copy. Official `pull_release` preserve closes the same class of overwrite for release extracts; rsync bakes must keep using `--exclude 'certs/wazuh-api.crt'`.
