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

**Purpose:** L3b self-signed SIEM API certificate for manager-only setup.

**Authority:** This file is tracked in git as the **source of truth** for the certificate fingerprint. When Wazuh manager generates its server certificate on first install, the certificate is extracted and committed to this repo. Future certificate rotations will update this file in git.

**When to update:** Update this file only when performing an **actual certificate rotation** (e.g., new Wazuh install, cert expiry, manual rotation). Do not update on every deployment — the extraction script (`setup_wazuh_tls_host.sh` on M4) may create local copies for runtime environment-variable injection, but the repo pin remains the authoritative source. Clients pin this file, not temporary runtime extracts.

**Scope:** This policy applies to **L3b scope only** (manager-only setup on OVN mon-net). Layer 5 production hardening will introduce proper PKI and may change the trust model entirely.

## Rotation

Re-extracting a certificate changes the fingerprint and **breaks every pinned
client at once**. When a service's cert is regenerated: extract the new one,
replace the file here, update the fingerprint in the table above, and redeploy
the hosts that consume it in the same change. Certificates in this directory
are checked for expiry as part of Layer 5 production hardening, which also
replaces these self-signed certs with proper PKI.
