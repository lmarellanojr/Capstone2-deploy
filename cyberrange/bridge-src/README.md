# SSH / web-terminal bridge

Host-side `lxc exec` PTY over `/api/ssh-websocket`. Not guacamole’s old Node microservice.

## On the Ampere (or M4) host

```bash
cd ~/cyberrange/bridge-src   # or $REPO/bridge-src
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # websockets==12.0
install -m 600 .env.bridge.example .env.bridge
# set KEYCLOAK_CLIENT_SECRET; Path B:
# KEYCLOAK_INTROSPECT_URL=http://10.115.77.12/auth/realms/cyber-range/protocol/openid-connect/token/introspect
# BRIDGE_BIND_HOST=10.115.77.1
```

User unit: `deploy/systemd/cyberrange-ssh-bridge.service`.

Do not bind `:8765` on the instance public IP. Portal rewrite `/api/ssh-websocket` → this bind.
