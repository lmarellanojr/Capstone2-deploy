# Chapter 06: Scoring (Optional)

Wire the Wazuh manager into the Provision API so student security events can be
scored.

**This chapter is optional and safe to skip.** Labs, terminals and DVWA all work
without it. Leave the `WAZUH_*` settings unset and the API skips Wazuh entirely.
Do not let scoring block a cutover.

Prerequisites: the Wazuh manager from Chapter 02 Step 4, and `meta-base` rebaked
with the agent in Chapter 03 Step 2.

---

## How the Wazuh API actually authenticates

Every mistake in this chapter comes from getting this wrong, so it is worth 30
seconds up front.

The Wazuh API is **JWT-based**, not HTTP Basic. Exactly one endpoint accepts basic
auth:

```
GET /security/user/authenticate        →  {"data": {"token": "<JWT>"}}
```

Every other call needs `Authorization: Bearer <token>` from that response. Sending
`-u user:pass` to `/security/users` or `/agents` returns **401**, no matter how
correct the credentials are.

This is exactly what the repo's own client does — see `get_wazuh_token()` in
`src/provisioning/wazuh_client.py`.

### TLS: use the hostname, never the IP

The API certificate has `subjectAltName = DNS:localhost` and **no IP SAN**. So:

| URL | Result |
|---|---|
| `https://localhost:55000` | verifies against the pinned cert |
| `https://127.0.0.1:55000` | **fails hostname verification**, even with the right CA file |

The LXD proxy device listens on `127.0.0.1:55000` and `localhost` resolves there,
so the hostname form costs nothing and is the only one that verifies.

> **Do not set `WAZUH_TLS_VERIFY=false`.** If verification fails, the cause is
> almost always the IP form of the URL or a stale pinned certificate — not the
> verification itself. Turning it off hides a real misconfiguration on a host that
> is reachable from the internet through a tunnel. Fix the URL or re-extract the
> certificate.

Set up a shell helper for the rest of this chapter:

```bash
WZ=https://localhost:55000
CA=~/cyberrange/certs/wazuh-api.crt
```

---

## Step 1: Create a read-only `scoring` user

The manager ships with a built-in `wazuh` account that has a **default password**
and the **administrator** role. Use it exactly once — to create the scoring user —
then never again.

### 1a. Get an admin token

```bash
ADMIN_TOKEN=$(curl -s -u wazuh:wazuh --cacert "$CA" \
  -X GET "$WZ/security/user/authenticate" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')

[ -n "$ADMIN_TOKEN" ] && echo "admin token acquired" || echo "FAILED"
```

### 1b. Create the user

```bash
SCORING_PW=$(openssl rand -base64 24)

curl -s -X POST "$WZ/security/users" --cacert "$CA" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"username\": \"scoring\", \"password\": \"$SCORING_PW\"}"
```

> **`POST /security/users` takes only `username` and `password`.** There is no
> `role` field. Passing one is ignored, and the user is created with **no roles at
> all** — which then fails every read with 403 and looks like a password problem.

Note the returned user `id` (it was **100** on the live host).

### 1c. Attach the read-only role — check the role ID, do not assume

```bash
curl -s --cacert "$CA" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$WZ/security/roles" \
  | python3 -c 'import sys,json; [print(r["id"], r["name"]) for r in json.load(sys.stdin)["data"]["affected_items"]]'
```

> **On this install, role `1` is `administrator` and role `2` is `readonly`.** An
> earlier revision of this chapter assumed role 1 was read-only, which would have
> granted the scoring account full administrative rights on a host published
> through a Cloudflare tunnel. Read the IDs from the output above every time — do
> not carry a number over from another deployment.

```bash
USER_ID=100        # from Step 1b
ROLE_ID=2          # the id whose name is 'readonly' in the listing above

curl -s -X POST --cacert "$CA" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$WZ/security/users/$USER_ID/roles?role_ids=$ROLE_ID"
```

### 1d. Verify the scoring user, and verify it is *not* an admin

```bash
SCORING_TOKEN=$(curl -s -u "scoring:$SCORING_PW" --cacert "$CA" \
  -X GET "$WZ/security/user/authenticate" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')

# Should succeed: reading agents
curl -s --cacert "$CA" -H "Authorization: Bearer $SCORING_TOKEN" "$WZ/agents" \
  | head -c 200; echo

# Should FAIL with 403: creating another user
curl -s -o /dev/null -w 'create-user %{http_code}\n' \
  -X POST "$WZ/security/users" --cacert "$CA" \
  -H "Authorization: Bearer $SCORING_TOKEN" -H 'Content-Type: application/json' \
  -d '{"username": "shouldfail", "password": "Abcd1234!"}'
```

**`403` on the second call is a required pass.** A `200` means `scoring` has
administrator rights — remove the wrong role and reattach `readonly` before going
any further.

The agent listing should show agent **000**, `wazuh-manager`, `active`.

---

## Step 2: Rotate the built-in account

You just used `wazuh:wazuh`, a published default, on a host that will be reachable
through a tunnel. Change it now.

```bash
curl -s -X PUT "$WZ/security/users/1" --cacert "$CA" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"password\": \"$(openssl rand -base64 24)\"}"
```

Store that password wherever you keep the deployment's other secrets. It is not
needed again in normal operation.

---

## Step 3: Point the Provision API at Wazuh

```bash
nano ~/cyberrange/env/.env
```

```bash
WAZUH_API_URL=https://localhost:55000
WAZUH_TLS_VERIFY=true
WAZUH_CA_BUNDLE=/home/llms_admin/cyberrange/certs/wazuh-api.crt
WAZUH_SCORING_USER=scoring
WAZUH_SCORING_PW=<the password from Step 1b>
```

> Note the path: `cyberrange/certs`, no hyphen. Everything this Manual installs
> lives under `~/cyberrange`.

The file is mode 600 and holds a live password — confirm, and never echo it into a
log or a commit:

```bash
stat -c '%a %n' ~/cyberrange/env/.env       # → 600
systemctl --user restart cyberrange-provision-api.service
```

---

## Step 4: Agents in student pods — run during Chapter 07's gate

`meta-base` carries wazuh-agent 4.7.5, pre-configured to auto-enrol against the
manager. Nothing to do per-pod.

> **No student pod exists yet.** The first one is created in Chapter 07's Path B
> gate. Configuration for scoring is finished at Step 3 above; run this step and
> Step 5 **while that pod is up**, then come back here. Nothing below blocks
> continuing to Chapter 07.

```bash
# While the Chapter 07 gate pod is running
lxc exec pod-student-1-meta -- systemctl is-active wazuh-agent
lxc exec pod-student-1-meta -- grep -A1 '<manager_address>' /var/ossec/etc/ossec.conf
# → 10.0.40.10

# From the host, as the scoring user
curl -s --cacert "$CA" -H "Authorization: Bearer $SCORING_TOKEN" "$WZ/agents" \
  | python3 -m json.tool | grep -E '"name"|"status"'
```

Enrolment is passwordless by design: the manager has
`<use_password>no</use_password>`, so the agent's `<enrollment>` defaults register
it on first start. There is no shared secret to distribute.

---

## Step 5: Check the alerts endpoint — also during Chapter 07's gate

```bash
curl -s -H "Authorization: Bearer <student access token>" \
  http://10.115.77.1:5000/pods/1/alerts
```

```json
{"alerts": [], "total_count": 0}
```

**An empty list is a pass.** It means the endpoint is wired and the pod genuinely
has no alerts yet — the live host's Task 12 recorded exactly this, and recorded it
as PASS specifically because it returned real emptiness rather than sample rows. A
populated response only appears once a student actually triggers a rule.

Do not block a cutover on seeing a non-empty alerts list.

---

## Disabling scoring

Leave these unset — or comment them out — and the API skips Wazuh entirely:

```bash
# WAZUH_API_URL=
# WAZUH_SCORING_USER=
# WAZUH_SCORING_PW=
```

Restart the API. Students keep full lab access; the portal simply shows no alerts.

---

## Troubleshooting

**Every call returns 401, and the password is definitely right**
You are sending `-u user:pass` to something other than
`/security/user/authenticate`. Get a token first, then use
`Authorization: Bearer`.

**`curl: (60) SSL certificate problem` / hostname mismatch**
The URL uses `127.0.0.1`. The certificate's only SAN is `DNS:localhost`. Use
`https://localhost:55000`. Do not reach for `-k` or `WAZUH_TLS_VERIFY=false`.

**`curl: (60)` even with `localhost`**
The pinned certificate does not match this install. A fresh Wazuh generates its
own — re-extract it (Chapter 02, Step 4e).

**403 on every read as `scoring`**
No role attached, or the wrong one. Re-run Step 1c after listing the roles.

**Agents register but never report**
Agent/manager version skew. Both must be 4.7.5:

```bash
lxc exec wazuh-manager -- /var/ossec/bin/wazuh-control info | head -3
lxc exec pod-student-1-meta -- /var/ossec/bin/wazuh-control info | head -3
```

**The manager is eating the host's memory**
Vulnerability detection is back on. Chapter 02, Step 4c — and check the **nvd** and
**msu** provider blocks individually, not just the parent element.

```bash
lxc exec wazuh-manager -- journalctl -u wazuh-manager -n 50 --no-pager
tail -n 50 /tmp/provision-api.log
```

---

**Next:** Chapter 07 — Deployment and Cutover
