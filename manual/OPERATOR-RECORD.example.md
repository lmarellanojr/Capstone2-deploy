# Operator record — template (safe to commit)

Copy to `private/OPERATOR-RECORD.local.md` (gitignored). Never commit the `.local` file. Never copy `private/` into `C:\Capstone2-Deploy`. Live IPs, tunnel UUIDs, and passwords belong only in `.local`.

| Field | Example / where to get it |
| :---- | :---- |
| OCI region / AD | e.g. Singapore AD-1 |
| Instance display name | from Compute → Instances |
| Instance OCID | instance details |
| Public IPv4 | instance Networking tab |
| VCN SSH `/32` | your IP from https://api.ipify.org |
| SSH user | `llms_admin` |
| SSH key (path only) | `~\.ssh\id_oci_arm64` — not the key bytes |
| Student URL | `https://<your-tunnel-host>/` |
| Cloudflare tunnel name | dashboard Tunnels list |
| Cloudflare tunnel UUID | tunnel overview |
| Origin | `http://10.115.77.12:80` |
| Keycloak admin | `~/cyberrange/deploy/keycloak/admin.env` on the VM (mode 600) |
| Portal client secret | `~/cyberrange/portal/.env.local` `KEYCLOAK_CLIENT_SECRET` |
| Student user | `student` |
| Student password | `~/cyberrange-data/student.env` on the VM — paste only into `.local` |
| Cloudflare token | `/etc/cloudflared/token` on the VM — **never** paste into git |

Tunnel token and student password stay on the VM unless you copy them into `.local` yourself.
