# `certs/` — committed trust anchors

## What belongs here

**Public certificates only.** Specifically: server certificates that client code
in this repo must pin in order to verify a TLS connection.

**Never commit private keys.** `.gitignore` already refuses `*.pem` and `*.key`;
do not add exceptions. A certificate is a public document — it is handed to
every client that opens a connection — so committing one leaks nothing. The
corresponding private key never leaves the host that generated it.

## Why these are committed rather than fetched

The services behind them use self-signed certificates that are deliberately
**not** installed into any host trust store. Pinning the exact certificate is
stronger than adding a self-signed CA to the system bundle, which would make it
trusted for every hostname on the box. Clients therefore point
`WAZUH_CA_BUNDLE` (and equivalents) at a file from this directory rather than
passing `verify=False`.

## Inventory

| File | Subject / SAN | Used by | Expires |
|------|---------------|---------|---------|
| `wazuh-api.crt` | `CN=wazuh.com`, **SAN: `DNS:localhost` only** | provision API scoring (`config.py`, `score_verifier.py`, `wazuh_client.py`) via `WAZUH_CA_BUNDLE` | 2027-09-02 |

### `wazuh-api.crt` — the SAN is load-bearing

This certificate has `subjectAltName = DNS:localhost` and **no IP SAN**. Any
client that connects to `https://127.0.0.1:55000` will fail hostname
verification even with this file supplied as the CA bundle. `WAZUH_API_URL`
must use the hostname form, `https://localhost:55000`. The LXD proxy device
listens on `127.0.0.1:55000`; `localhost` resolves there, so the hostname form
costs nothing and is the only one that verifies.

Extracted from the Wazuh manager on the Ampere live host (`ssh myampere`,
manager installed 2026-09-02) on 2026-09-30. It replaced an earlier pin from a
different install whose fingerprint (`2B:95:7C…`) matched neither the live
manager nor the value previously documented here (`B2:9F:8E…`), so scoring on
Ampere failed TLS verification. Verify a checkout still matches the live
service before relying on it:

```bash
openssl x509 -in certs/wazuh-api.crt -noout -fingerprint -sha256
ssh myampere 'openssl s_client -connect localhost:55000 -servername localhost </dev/null 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256'
# Both: E2:48:A0:E6:F6:5C:A1:C3:1A:70:4A:99:D1:2D:F4:FC:95:C5:99:6C:11:36:5B:B0:A0:0E:5B:F8:06:4E:35:97
```

### `wazuh-api.crt` — Repository Pin Policy

**Purpose:** Self-signed Wazuh manager API certificate used by provision-API
scoring via `WAZUH_CA_BUNDLE` (typically `~/cyberrange/certs/wazuh-api.crt`).

**Authority (two roles):**

1. **Committed pin (this file)** — bootstrap / fresh-tree **starter** and the
   documented fingerprint reference in git. `pack_tree` still ships it in
   release tarballs so a host with no cert file can install a starter pin.
2. **Host file on Ampere** — after Manual 02 §4e extract (or any live
   re-extract), the file at `~/cyberrange/certs/wazuh-api.crt` is the
   **runtime** pin for that host and must match **that** host’s
   `wazuh-manager` cert. Per-Ampère pins differ; do **not** copy a pin
   across hosts.

`pull_release` / `release_sync.extract_tree` **preserves** an existing
`certs/wazuh-api.crt` (exact relpath). Routine promotes do **not** overwrite
a host pin with the git starter. Missing file → tarball starter is installed.

**When to update git:** Only on an intentional starter-pin change (new
reference install, documented rotation). Do not commit every host’s live
extract.

**Scope:** L3b / Ampere self-signed manager API. Layer 5 may replace this
with proper PKI.

## Rotation

Three distinct ops paths (do not conflate them):

- **A — Routine `pull_release`:** no cert step; existing host pin is preserved.
- **B — Install a newer git starter onto a live host:** `pull_release` alone
  does **not** re-extract when the release SHA already equals `DEPLOYED_SHA`
  (`--check-apply` returns unchanged and exits before `--extract`). Removing
  the host pin and calling `pull_release` without forcing apply leaves the
  host **cert-less**. Use a forced full apply:

  ```bash
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  export DBUS_SESSION_BUS_ADDRESS=unix:path=${XDG_RUNTIME_DIR}/bus
  ROOT=$HOME/cyberrange
  systemctl --user stop cyberrange-pull-release.timer
  cp -a "$ROOT/certs/wazuh-api.crt" \
    "$ROOT/certs/wazuh-api.crt.bak.$(date +%Y%m%d%H%M)"
  rm -f "$ROOT/certs/wazuh-api.crt"
  cp -a "$ROOT/DEPLOYED_SHA" "$ROOT/DEPLOYED_SHA.bak.force"
  printf '%040d\n' 0 > "$ROOT/DEPLOYED_SHA"
  bash "$ROOT/deploy/host/pull_release.sh"
  ls -l "$ROOT/certs/wazuh-api.crt"
  openssl x509 -in "$ROOT/certs/wazuh-api.crt" -noout -fingerprint -sha256
  ```

  This forces a **full** release apply (snapshot, tree extract, lock check,
  unit restarts), not a cert-only repair. Keep the cert and `DEPLOYED_SHA`
  backups until fingerprint and Admin checks pass. On failure, restore both
  backups from those copies (`fail_apply` does not restore `DEPLOYED_SHA`);
  clear `~/cyberrange-data/rollback/bad-sha` only after fixing the cause, then
  retry. A successful pull rewrites `DEPLOYED_SHA` to the real release SHA.
  Restart `cyberrange-pull-release.timer` when finished.
- **C — Live manager cert regenerated / TLS verify failed (`curl` exit 60):**
  re-extract from that host’s `wazuh-manager` per Manual 02 §4e onto
  `~/cyberrange/certs/wazuh-api.crt` (installs the **live** cert, not the
  git pin). Update git later only if this host’s pin should become the
  committed starter.

Re-extracting changes the fingerprint for clients that pin the old file.
Verify with `openssl x509 -fingerprint -sha256` against
`openssl s_client -connect localhost:55000` on the same host. Never set
`WAZUH_TLS_VERIFY=false` to bypass a mismatch.
