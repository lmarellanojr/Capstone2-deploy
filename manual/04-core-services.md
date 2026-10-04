# Chapter 04: Core Services

Bring up Keycloak, the Provision API, the Portal, and the SSH bridge.

**The Cloudflare tunnel is not in this chapter.** It goes up last, in Chapter 07,
after a pod has been provisioned end to end on the private Path B address. Do not
start `cloudflared` here.

---

## Service map

Read this table before running anything. The five services do **not** all run in
the same place, and three different systemd contexts are involved.

| Service | Unit file | systemd context | Runs where | Listens on |
|---|---|---|---|---|
| Keycloak | `keycloak.service` | **system** (user `keycloak`) | **inside the `guacamole` container** | `127.0.0.1:8083`, published by nginx on `10.115.77.12:80/auth/` |
| Provision API | `cyberrange-provision-api.service` | **user** (`llms_admin`) | Ampere host | `10.115.77.1:5000` |
| Portal | `cyberrange-portal.service` | **user** (`llms_admin`) | Ampere host | `10.115.77.1:3000` |
| SSH bridge | `cyberrange-ssh-bridge.service` | **user** (`llms_admin`) | Ampere host | `10.115.77.1:8765` |
| Cloudflare tunnel | `cloudflared.service` | **system** (`User=llms_admin`) | Ampere host | outbound only — **Chapter 07** |

> **The unit files are named `cyberrange-*`.** There is no `provision-api.service`,
> `portal.service`, or `bridge.service` in this repo. Copying those names produces
> `No such file or directory`.

> **`cloudflared.service` is a system unit, not a user unit.** It sets `User=` and
> `WantedBy=multi-user.target`; systemd **rejects `User=` in user units**, so
> `systemctl --user enable cloudflared` cannot work. Chapter 07 installs it under
> `/etc/systemd/system/` with `sudo`.

Nothing binds `0.0.0.0`. Every host service binds the `lxdbr0` address
`10.115.77.1`, which is unreachable from the internet. Verified in Step 8.

---

## Order, and why

```
Keycloak  →  Provision API  →  Portal  →  SSH bridge  →  (Chapter 07: tunnel)
```

The API runs with `AUTH_ENABLED=true` and introspects every request against
Keycloak, and the Portal's OIDC login needs the realm to exist. Starting the API
or Portal before Keycloak answers gives you failures that look like application
bugs but are ordering mistakes.

---

## Step 0: Host prerequisites

```bash
# On the Ampere host, as llms_admin

# The API drives LXD over the unix socket — llms_admin must be in the lxd group.
id -nG | tr ' ' '\n' | grep -x lxd || echo "MISSING: sudo usermod -aG lxd llms_admin, then log out and back in"

# User units must survive SSH logout and start at boot.
loginctl enable-linger "$USER"
loginctl show-user "$USER" | grep Linger    # → Linger=yes
```

If `enable-linger` fails, the services stop the moment you disconnect. Fix it here
rather than discovering it during the Chapter 07 reboot test.

---

## Step 1: Keycloak (inside the `guacamole` container)

Keycloak is a **native** install inside the gateway container — not Docker, not a
host unit. It binds `127.0.0.1:8083` inside the container and is reached only
through the nginx vhost you configured in Chapter 02.

### 1a. Java and the Keycloak distribution

```bash
# On the Ampere host
lxc exec guacamole -- apt-get update
lxc exec guacamole -- apt-get install -y openjdk-21-jre-headless curl

# Keycloak 25.0.6 (the version this deployment was proven on)
lxc exec guacamole -- bash -c '
  cd /opt
  curl -fsSL -o keycloak.tar.gz \
    https://github.com/keycloak/keycloak/releases/download/25.0.6/keycloak-25.0.6.tar.gz
  tar xzf keycloak.tar.gz
  rm -f keycloak.tar.gz
  ln -sfn /opt/keycloak-25.0.6 /opt/keycloak
'

lxc exec guacamole -- test -x /opt/keycloak/bin/kc.sh && echo "keycloak distribution OK"
lxc exec guacamole -- java -version    # → openjdk 21.x
```

### 1b. Admin credentials

```bash
# On the Ampere host
cd ~/cyberrange/deploy/keycloak
install -m 600 admin.env.example admin.env

# Generate an admin password and write it into admin.env.
openssl rand -base64 24
```

Edit `admin.env` and replace `${KEYCLOAK_ADMIN_PASSWORD}` with the generated value.
Keep `KEYCLOAK_ADMIN=admin`.

`admin.env` is a secret: mode **600**, never committed. The installer pushes it to
`/etc/keycloak/admin.env` inside the container as `root:root 0600`.

### 1c. Install the unit

The repo ships an installer that creates the `keycloak` system user, frees port
8083, pushes the unit and the admin env file, seeds `/etc/hosts`, and then polls
the OIDC discovery endpoint until Keycloak answers.

```bash
cd ~/cyberrange
bash deploy/host/install_keycloak_unit.sh
```

Expected tail:

```text
active
enabled
keycloak native install: OK
```

On a first deploy the script prints
`NOTE: no host-canonical realm JSON yet -- expected on a first deploy.`
That is correct — the realm is created in Chapter 05.

### 1d. Verify through nginx

```bash
# Inside the container — Keycloak itself
lxc exec guacamole -- curl -fsS \
  http://127.0.0.1:8083/auth/realms/master/.well-known/openid-configuration \
  | head -c 80; echo

# From the host — through the nginx vhost, which is what the API and Portal use
curl -s -o /dev/null -w '%{http_code}\n' http://10.115.77.12/auth/
# → 302
```

**302 on `/auth/` is success.** A **404** here means nginx is still holding the
stock `0.0.0.0:80` socket from `apt-get install nginx`; `systemctl reload` will not
release it. Fix with a full restart:

```bash
lxc exec guacamole -- systemctl stop nginx
lxc exec guacamole -- systemctl start nginx
lxc exec guacamole -- ss -ltn | grep :80     # → 10.115.77.12:80 only
```

### 1e. Create the realm, the `portal` client and the student user

Keycloak is running, but it has only the `master` realm. Nothing can log in until
the `cyber-range` realm exists.

```bash
cd ~/cyberrange
bash deploy/host/create_keycloak_realm.sh
```

Expected tail:

```text
REALM_OK
env client secret updated (not printed)
student.env written (password not printed)
=== well-known ===
HTTP 200
issuer http://10.115.77.12/auth/realms/cyber-range
TASK8_REALM_DONE
```

What it does, so you know what to re-do by hand if it fails partway:

| Creates | Detail |
|---|---|
| realm `cyber-range` | enabled |
| client `portal` | confidential, standard flow + direct grants, secret generated with `openssl rand -hex 24` |
| user `student` | `emailVerified=true`, first/last name set, password non-temporary |
| — | `VERIFY_PROFILE` disabled on the realm |

It then writes the generated client secret into `~/cyberrange/env/.env`
(mode 600) and the student password into `~/cyberrange-data/student.env`
(mode 600). **Neither is printed.** Read the student password with:

```bash
sudo cat ~/cyberrange-data/student.env
```

> `emailVerified=true` and the disabled `VERIFY_PROFILE` matter. Without them the
> student's first login lands on Keycloak's "Update Account Information" form
> instead of the dashboard — which is what happened on the live host.

> **Re-running mints a new client secret** and rewrites `env/.env` with it. If you
> re-run after Step 5c, you must copy the new value into `portal/.env.local` as
> well or every login fails with `invalid_client`. Do not re-run it to fix an
> unrelated problem.

The client is created with one redirect URI, `http://10.115.77.1:3000/*`. Path B
login needs a second:

```bash
lxc exec guacamole -- bash -c '
  set -a; . /etc/keycloak/admin.env; set +a
  export PATH=/opt/keycloak/bin:$PATH
  kcadm.sh config credentials --server http://127.0.0.1:8083/auth \
    --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
  CID=$(kcadm.sh get clients -r cyber-range -q clientId=portal --fields id --format csv --noquotes | tail -1)
  kcadm.sh update "clients/$CID" -r cyber-range \
    -s \'redirectUris=["http://10.115.77.1:3000/*","http://10.115.77.12/*"]\' \
    -s \'webOrigins=["http://10.115.77.1:3000","http://10.115.77.12"]\'
'
```

Chapter 07 adds the HTTPS tunnel URI to this list; it does not replace it.

Verify the realm answers through nginx:

```bash
curl -s http://10.115.77.12/auth/realms/cyber-range/.well-known/openid-configuration \
  | grep -o '"issuer":"[^"]*"'
# -> "issuer":"http://10.115.77.12/auth/realms/cyber-range"
```

---

## Step 2: The API environment file

`cyberrange-provision-api.service` has a hard
`EnvironmentFile=/home/llms_admin/cyberrange/env/.env`. The unit **will not start**
until that file exists.

```bash
cd ~/cyberrange
[ -f env/.env ] || install -m 600 env/oci-12gib.env.example env/.env
chmod 600 env/.env
```

> The guard matters. Step 1e wrote the client secret into `env/.env`; a plain
> `install` over it would silently wipe that value and every login would fail with
> `invalid_client`.

Step 1e already wrote `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` and
`KEYCLOAK_INTROSPECT_URL` into this file. Confirm they are present and non-empty
without printing the secret:

```bash
grep -c '^KEYCLOAK_CLIENT_SECRET=.\+' ~/cyberrange/env/.env     # -> 1
grep '^KEYCLOAK_INTROSPECT_URL=' ~/cyberrange/env/.env
# -> http://10.115.77.12/auth/realms/cyber-range/protocol/openid-connect/token/introspect
```

Leave `PROFILE=oci_12gib`, `MAX_PODS=1`, `POD_RAM_MB=4096`, `RAM_BUFFER_MB=1536`
and `POD_STORAGE_MB=7168` as shipped — they are the 12 GiB shape's proven values.

Confirm the mode:

```bash
stat -c '%a %n' ~/cyberrange/env/.env    # → 600
```

---

## Step 3: Python virtualenv for the Provision API

Ubuntu 24.04 is **PEP 668 managed**. Do not `pip install` into the system Python
and do not use `pip install --user` — both are refused or, worse, silently break
system packages.

```bash
# Ubuntu 24.04 Minimal ships python3 without ensurepip.
sudo apt-get install -y python3.12-venv

cd ~/cyberrange
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e .          # dependencies come from pyproject.toml

.venv/bin/python -c 'import fastapi, uvicorn, pylxd; print("api deps OK")'
```

`pip install -e .` is what CI runs, so the dependency list has exactly one home:
`[project] dependencies` in `pyproject.toml`. The install provides the
dependencies and puts `src/` on the path; it does **not** need to import the API
as a package, because the unit runs `provision_api_fastapi.py` as a plain script
from `WorkingDirectory`.

> **It needs network access.** `pyproject.toml` declares no `[build-system]`, so
> pip falls back to setuptools and — since Python 3.12 no longer ships setuptools
> in a fresh venv — fetches it through build isolation. That is fine on Ampere,
> which has egress. On a host without PyPI access, install the same list directly
> instead:
>
> ```bash
> .venv/bin/pip install fastapi pydantic requests urllib3 uvicorn pylxd
> ```
>
> Keep that list in step with `pyproject.toml` if you use it.

> If `python3 -m venv` fails, `import venv` succeeding is **not** proof the module
> works — `ensurepip` is a separate package. Install `python3.12-venv`, then
> `rm -rf .venv` before retrying. A half-created venv will not repair itself.

### The shipped unit points at system Python — override it

`deploy/systemd/cyberrange-provision-api.service` ships
`ExecStart=/usr/bin/python3 provision_api_fastapi.py`. Add a drop-in so the unit
uses the venv instead. You will install this in Step 7, after the unit is copied.

---

## Step 4: Node runtime for the Portal

The Portal unit hardcodes `/home/llms_admin/opt/node/bin/npm`. There is **no system
Node** on this host by design, so that path must exist.

```bash
cd ~
curl -fsSLO https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-arm64.tar.xz
mkdir -p ~/opt
tar xf node-v20.18.1-linux-arm64.tar.xz -C ~/opt
mv ~/opt/node-v20.18.1-linux-arm64 ~/opt/node
rm -f node-v20.18.1-linux-arm64.tar.xz

~/opt/node/bin/node --version      # → v20.18.1
~/opt/node/bin/npm --version
```

Add it to your interactive shell too, or `npm` will fail with
`/usr/bin/env: 'node': No such file or directory`:

```bash
echo 'export PATH="$HOME/opt/node/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/opt/node/bin:$PATH"
```

---

## Step 5: Build the Portal off-host and ship it

**Do not run `npm run build` on the Ampere host.** A Next.js build peaks well above
what 12 GiB leaves free once LXD, Keycloak and Wazuh are running, and a build
launched from a shell is outside the portal unit's cgroup, so the `MemoryMax`
drop-in gives it no protection at all.

### 5a. On the operator PC

```bash
cd C:\Capstone2-Deploy\cyberrange\portal   # kit; or C:\Capstone2Implementation\portal
npm ci
npm run build
```

You do **not** need a PC `.env.local` for this build. Client calls default to
`/api` (same-origin portal routes). `NEXTAUTH_URL` is **not** baked in; Chapter 07
sets it on the host and restarts the unit.

The federated-logout dynamic-route warning is expected and non-blocking.

### 5b. Ship the build artifacts

Send `.next` (without its `cache` directory), `public`, `next.config.mjs`,
`package.json` and `package-lock.json` to `~/cyberrange/portal/` on Ampere.

```bash
# On the operator PC
tar czf portal-build.tgz --exclude='.next/cache' .next public next.config.mjs package.json package-lock.json
scp -i ~/.ssh/id_oci_arm64 portal-build.tgz llms_admin@<PUBLIC_IP>:~/cyberrange/portal/
```

```bash
# On Ampere
cd ~/cyberrange/portal
tar xzf portal-build.tgz
rm -f portal-build.tgz
npm ci --omit=dev
```

> Extract without piping to `head`. Under `set -e`, `tar -tf … | head` takes a
> SIGPIPE and aborts the script.

### 5c. Portal environment file

```bash
cd ~/cyberrange/portal
install -m 600 .env.local.example .env.local
```

Set `KEYCLOAK_CLIENT_SECRET` (same value as `env/.env`), generate
`NEXTAUTH_SECRET` with `openssl rand -base64 32`, and set
`NEXTAUTH_URL=http://10.115.77.12` for now. Chapter 07 flips it to the HTTPS
hostname.

> **If `.env.local` already exists, merge — never `install` over it.** The example
> file has an empty `KEYCLOAK_CLIENT_SECRET`, so copying it over a working file
> silently wipes the secret and every login fails with `invalid_client`.

Keycloak's `portal` client needs both redirect URIs while you are on Path B:
`http://10.115.77.1:3000/*` and `http://10.115.77.12/*`.

---

## Step 6: SSH bridge virtualenv and environment

```bash
cd ~/cyberrange/bridge-src
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt      # websockets==12.0
.venv/bin/python -c 'import websockets; print(websockets.__version__)'   # → 12.0

install -m 600 .env.bridge.example .env.bridge
```

Edit `.env.bridge`:

```bash
KEYCLOAK_INTROSPECT_URL=http://10.115.77.12/auth/realms/cyber-range/protocol/openid-connect/token/introspect
KEYCLOAK_CLIENT_SECRET=<same secret as env/.env>
BRIDGE_BIND_HOST=10.115.77.1
BRIDGE_BIND_PORT=8765
```

The unit has a hard `EnvironmentFile=` on `.env.bridge` and runs
`.venv/bin/python` — note the leading dot. A venv named `venv` will not be found.

The bridge is **not an SSH daemon**. It is a websockets server that opens an
`lxc exec` PTY into the student's container, published by nginx at
`/api/ssh-websocket`. There is nothing to `ssh` to.

---

## Step 7: Install and start the three host user units

```bash
cd ~/cyberrange
bash deploy/systemd/install-user-units.sh
```

That copies `cyberrange-provision-api.service`, `cyberrange-ssh-bridge.service`
and `cyberrange-portal.service` into `~/.config/systemd/user/`, runs
`daemon-reload`, enables linger, and enables all three.

### 7a. Point the API at the venv

```bash
mkdir -p ~/.config/systemd/user/cyberrange-provision-api.service.d
cat > ~/.config/systemd/user/cyberrange-provision-api.service.d/venv.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/home/llms_admin/cyberrange/.venv/bin/python provision_api_fastapi.py
EOF
```

The empty `ExecStart=` is required — without it systemd appends a second command
rather than replacing the shipped one.

### 7b. Cap the Portal's memory

```bash
mkdir -p ~/.config/systemd/user/cyberrange-portal.service.d
cp ~/cyberrange/portal/cyberrange-portal.service.d/memory.conf \
   ~/.config/systemd/user/cyberrange-portal.service.d/memory.conf
```

### 7c. Start them, in order

```bash
systemctl --user daemon-reload

systemctl --user start cyberrange-provision-api.service
sleep 3
systemctl --user start cyberrange-portal.service
sleep 10
systemctl --user start cyberrange-ssh-bridge.service

systemctl --user --no-pager status \
  cyberrange-provision-api.service \
  cyberrange-portal.service \
  cyberrange-ssh-bridge.service | grep -E 'Active:|●'
```

All three should report `active (running)`.

Verify the memory cap applied:

```bash
systemctl --user show -p MemoryMax cyberrange-portal.service
# → MemoryMax=536870912
```

---

## Step 8: Verify

### Binds — lxdbr0 only, never `0.0.0.0`

```bash
ss -ltn | grep -E '3000|5000|8765'
```

Expected exactly:

```text
LISTEN  10.115.77.1:5000
LISTEN  10.115.77.1:3000
LISTEN  10.115.77.1:8765
```

A local `0.0.0.0:` on any of those three is a failure — stop and fix the bind
before continuing. (A `0.0.0.0:*` in the *peer* column is normal and not a public
bind.)

### Provision API

```bash
curl -s http://10.115.77.1:5000/health
# → {"status":"ok"}

curl -s http://10.115.77.1:5000/capacity
# → {"available_mb":...,"active_pods":0,"max_pods":1,"pod_ram_mb":4096,
#    "ram_buffer_mb":1536,"profile":"oci_12gib","ram_required_mb":5632,
#    "can_provision":true}

curl -s -o /dev/null -w '%{http_code}\n' http://10.115.77.1:5000/pods
# → 401
```

`401` on `/pods` is the **correct** result: `AUTH_ENABLED=true` and no token was
sent. A `200` here means auth is off — stop and fix `env/.env`.

`/capacity` does not report `POD_STORAGE_MB`; confirm that value directly:

```bash
grep POD_STORAGE_MB ~/cyberrange/env/.env      # → 7168
```

### Keycloak

```bash
curl -s http://10.115.77.12/auth/realms/cyber-range/.well-known/openid-configuration \
  | head -c 120; echo
```

Before Chapter 05 creates the realm this 404s — that is expected. The `master`
realm answering (Step 1d) is the proof Keycloak itself is healthy.

### Portal

```bash
curl -s -o /dev/null -w 'root %{http_code}\n'  http://10.115.77.1:3000/
curl -s -o /dev/null -w 'login %{http_code}\n' http://10.115.77.1:3000/login
curl -s -o /dev/null -w 'pathb %{http_code}\n' http://10.115.77.12/
```

Expected `307`, `200`, `307`. The Path B `307` proves nginx is reaching the portal
on the host.

### SSH bridge

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  --max-time 5 http://10.115.77.12/api/ssh-websocket
# → 101
```

`101` is the handshake through nginx. curl then hangs for a few seconds and times
out — that is the bridge holding the socket while it fails closed on the missing
token, **not** a 502. Typing in a real terminal is Chapter 08.

### Unit templates

```bash
cd ~/cyberrange
python3 -m pytest deploy/systemd/test_validate_units.py -q
# → 8 passed
```

---

## Step 9: Admin user management (one-time)

The portal's **Admin → Users** page (list, create, enable/disable, role change,
password and MFA reset) talks to Keycloak through a dedicated service-account
client, `cyberrange-user-admin`. Nothing above creates it, and its secret is not
in git, so **every fresh host needs this step once**. Without it every
`/admin/users` call answers `503 User management is not configured`, and the
Admin → Users page shows that message with a pointer back here (#145).

Run it after Step 1e (the realm must exist) and Step 7c (the API must be
installed):

```bash
cd ~/cyberrange
bash deploy/host/setup_user_admin_client.sh
systemctl --user restart cyberrange-provision-api.service
```

Expected tail:

```text
GET users?max=1                    HTTP 200
GET roles/student                  HTTP 200
...
USER_ADMIN_SETUP_OK
```

What it does: creates (or re-locks) the confidential, service-account-only
client `cyberrange-user-admin` with exactly `view-users`, `query-users`,
`manage-users` and `view-realm`; forces `registrationAllowed=false`; and writes
`KEYCLOAK_USER_ADMIN_CLIENT_ID` / `KEYCLOAK_USER_ADMIN_CLIENT_SECRET` into
`env/.env` without printing the secret. It is idempotent and does **not** rotate
the secret on re-run. Full contract: `docs/ADM-USER-contract.md` §7.

Verify:

```bash
grep -c '^KEYCLOAK_USER_ADMIN_CLIENT_SECRET=.\+' ~/cyberrange/env/.env   # → 1
journalctl --user -u cyberrange-provision-api --since -2min --no-pager \
  | grep -c 'user management is NOT configured'                         # → 0
```

Then sign in as an Admin and open **Admin → Users**: the user list loads and
**Create user** works. You need at least one account with the `admin` realm
role to reach that page; `deploy/host/create_demo_accounts.sh` creates
`admin_demo`, `instructor_demo` and `student_demo`.

---

## Not in this chapter

| Task | Where |
|---|---|
| Cloudflare tunnel, token, public hostname | Chapter 07 |
| Realm, `portal` client, student user | Chapter 05 |
| Wazuh scoring user and alerts | Chapter 06 |
| Provisioning a pod and using the terminal | Chapter 08 |

---

## Troubleshooting

**`Failed to start … Unit cyberrange-provision-api.service not found`**
`install-user-units.sh` was not run, or it was run before `~/cyberrange` existed.
Re-run it and `systemctl --user daemon-reload`.

**API exits immediately, journal says `EnvironmentFile … No such file`**
`env/.env` is missing. Step 2.

**API starts but `ModuleNotFoundError: fastapi`**
The venv drop-in (7a) is missing, so the unit is running system Python. Check
`systemctl --user show -p ExecStart cyberrange-provision-api.service`.

**Portal fails with `/usr/bin/env: 'node': No such file or directory`**
`~/opt/node` is missing or `PATH` was not exported. Step 4.

**Portal starts but every page is unstyled**
`postcss.config.js` and `tailwind.config.js` must sit next to `package.json`
*before* `npm run build` on the operator PC. Rebuild off-host and re-ship.

**Bridge exits with `ModuleNotFoundError: websockets`**
The venv is named `venv` instead of `.venv`, or `requirements.txt` was not
installed. Step 6.

**Login returns `invalid_client`**
`KEYCLOAK_CLIENT_SECRET` differs between `env/.env`, `portal/.env.local` and the
Keycloak realm. Usually caused by copying `.env.local.example` over a working
`.env.local`. See also Chapter 09, Issue 3.

**Admin → Users says "User management is not configured"**
The `cyberrange-user-admin` client was never created on this host, or the API
was not restarted afterwards. Step 9. The API also logs
`ADM-USER: user management is NOT configured` once at startup.

**Services vanish after you disconnect**
Linger is off. Step 0.

```bash
tail -n 50 /tmp/provision-api.log
tail -n 50 /tmp/portal.log
tail -n 50 /tmp/ssh-bridge.log
lxc exec guacamole -- journalctl -u keycloak.service -n 50 --no-pager
```

---

**Next:** Chapter 05 — Provisioning API and Portal
