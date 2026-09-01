# **Ampere Session G: Cloudflare Tunnel Guide for First-Time Operators**

**Audience:** You already have the Ampere VM running. You have never set up a Cloudflare Tunnel. You are not expected to know Zero Trust jargon.  
**Job of this file:** Get students onto **one HTTPS hostname** without opening Oracle ports 80/443, without putting DVWA on the public internet, and without inventing a hostname.  
**Not this file:** Keycloak URL flips on the VM (Manual `07-deployment-and-cutover.md`). After G3 (token on the VM), you tell the hostname; Manual 07 finishes HTTPS URLs.

| Role | Path |
| :---- | :---- |
| This guide (human, Session G) | `Ampere Cloudflare Tunnel Guide for First-Time Operators.md` (this file) |
| Parent (Sessions A–F) | `M4 to Ampere Guide for First-Time OCI.md` |
| Host cutover | Manual `07-deployment-and-cutover.md` |
| Portal CSS / Tailwind | Manual `04` / `05` — `postcss.config.js` and `tailwind.config.js` next to `portal/package.json` |

**Do not** open Oracle Security List ports 80, 443, 3000, 18301, 5000, or 8765 “so the website works.” That is a **failed** deploy even if the page loads.

## **Before you start Session G**

The lab must already work on the **private** path (`http://10.115.77.12/` from the VM itself). Students must not type the Oracle public IP. Live hostname / tunnel id for an existing host: `private/OPERATOR-RECORD.local.md`.

| Field | What you use |
| :---- | :---- |
| Public IPv4 | `<PUBLIC_IP>` (**SSH 22 only** — not a website) |
| Student origin (private) | **`http://10.115.77.12:80`** (guacamole nginx) — same on every host |
| `cloudflared` | Linux binary on the VM; unit **active + enabled** |
| Token file | `/etc/cloudflared/token` mode **600**, owner **`llms_admin`** (never paste the value into chat or git) |
| Student hostname | **`https://<TUNNEL_HOST>`** — a name **you** own |
| Tunnel name | the **Healthy** tunnel. If a leftover tunnel is **Down**, do not point DNS at it. |
| Public IP probe | `:80 :443 :3000 :5000 :18301 :8765` all **timeout** from your PC — **keep it that way** |

Published route is `http://10.115.77.12:80`. DNS for the student name must target the **Healthy** tunnel. Login CSS needs a Tailwind-compiled `.next` (see G5a). Students open the **HTTPS name**, never `http://10.115.77.12` from a home browser.

## **0\. Picture in your head (read this once)**

Oracle’s public IP is only for **your SSH**. Students open **HTTPS on a name you own**, which Cloudflare terminates. Cloudflare then talks **HTTP** to the lab gateway that already exists:

```text
  Student phone / home Wi‑Fi
        │  https://YOUR-NAME/...
        ▼
  Cloudflare (public HTTPS, DDoS, certs)
        │  named tunnel (cloudflared on the VM)
        │  HTTP only — never a second public port
        ▼
  guacamole nginx   10.115.77.12:80
        ├── /                    portal login / dashboard
        ├── /auth/               Keycloak
        ├── /lab/dvwa/           DVWA (after portal login)
        └── /api/ssh-websocket   Kali / Meta terminal

  <PUBLIC_IP>
        └── TCP 22 from YOUR /32   you (admin)
        └── 80, 443, 3000, 18301, 5000, 8765   CLOSED
```

If you remember only four rules:

> 1. **One** public hostname. Type = **HTTP**. URL = **`http://10.115.77.12:80`**. Not `https://`, not `localhost`, not `:3000`, not the Oracle public IP.  
> 2. Do **not** add Oracle firewall rows for websites.  
> 3. Do **not** create a second hostname for DVWA or `:18301`. DVWA is same-site `/lab/dvwa/` after login.  
> 4. Paste the tunnel **token** into a file on the VM. Never put it in chat, git, or a screenshot.

## **1\. Words you will see (Cloudflare)**

| Word on screen | Plain meaning |
| :---- | :---- |
| **Zone / domain** | A name you already pointed at Cloudflare DNS (example: `example.com`). You cannot finish Session G without one. A free Cloudflare account can hold a domain. |
| **Zero Trust** | Cloudflare’s “Tunnels / Access” area. We use **Tunnels** only. We do **not** turn on Access (that would add a second login in front of Keycloak). |
| **Networks → Tunnels** | List of pipes from Cloudflare’s network into *your* VM. |
| **Cloudflared** | The connector type. A small program already on Ampere. Not “WARP”, not “WARP Connector”. |
| **Named / remotely-managed tunnel** | Cloudflare remembers the tunnel. You paste a **token** on the VM. Dashboard can add hostnames later without SSH. This is what we use. |
| **Token** | A long secret that proves *this* VM is *this* tunnel. Treat it like a password. Mode 600 on disk. |
| **Public hostname** | What students type: `lab.example.com`. Cloudflare creates the DNS CNAME for you. |
| **Service / origin** | Where Cloudflare sends the request **inside** your lab. Ours is **`http://10.115.77.12:80`**. |
| **Connector / Healthy** | The VM’s `cloudflared` is talking to Cloudflare. Until this is Healthy, students get errors. |
| **Access application** | Extra Cloudflare login. **Skip** for now (Keycloak is the student login). |

## **2\. What you must not click**

| Tempting click | Why not |
| :---- | :---- |
| Oracle Security List **TCP 80 or 443 from 0.0.0.0/0** | Forbidden. Students use the tunnel, not the public IP. |
| Tunnel service **`http://localhost:3000`** or **`http://127.0.0.1:3000`** | Portal is on `10.115.77.1:3000`. Students must hit **nginx** on **`10.115.77.12:80`** so `/auth/` and `/lab/dvwa/` stay on the same site. |
| Tunnel service **`https://10.115.77.12`** | Origin is **HTTP**. nginx has no public TLS cert. Cloudflare already does HTTPS for students. |
| Tunnel service **`http://<PUBLIC_IP>:80`** | That port is **closed**. Origin is the **private** guacamole address. |
| A **second** public hostname for DVWA / `:18301` / `:5000` | Would put a teaching SQLi app or the API on the internet. |
| Dashboard “copy this **apt install** / **Windows** install command and run it” | Ampere **already has** `cloudflared` 2026.8.2. Those snippets are the wrong OS or would install a second copy. We only need the **token**. |
| **Quick Tunnels** (`trycloudflare.com` random name) | Fine for a 10‑minute demo, **not** for students. Name changes; we cannot pin Keycloak redirects. |
| **Cloudflare Access** “protect this app” on day one | Second login wall. Skip until the lab login works. |
| Pasting the token into Discord / this chat / a screenshot | Rotate the tunnel if you did. Send the agent only the **hostname**. |
| `echo TOKEN > /etc/cloudflared/token` | Lands in shell history. Use the stdin method in G3. |

## **3\. What you need before G1**

1. A **Cloudflare account** (free is enough).  
2. A **domain** whose DNS is on Cloudflare (grey-cloud or orange-cloud; the tunnel wizard will add a CNAME). If you have no domain, buy a cheap one and add it as a Cloudflare zone **first**. Session G cannot invent `something.cfargotunnel.com` as the student URL.  
3. SSH to Ampere as `llms_admin` (`Host ampere`).  
4. Tasks 1–12 already **PASS** (they are, on this tenancy).

You do **not** need to install `cloudflared` again.

## **4\. Session G1 — Create the named tunnel (Cloudflare website)**

Do this in a browser, not on the VM.

> 1. Open [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com) (Zero Trust). If Cloudflare asks you to pick a team name, that is just a label for this Zero Trust org.  
> 2. Left menu: **Networks** → **Tunnels** (the page title may be **Tunnels & Mesh**).  
> 3. **Create a tunnel**. If this VM already has a **Healthy** tunnel, **do not create a second one**. Use that row. Leave any **Down** leftover tunnel alone.  
> 4. Connector type: **Cloudflared** (not WARP). Next.  
> 5. Name: something boring like `cyberrange-ampere`. Save tunnel.

You now see “install connector” with OS tabs and a command that contains `--token` and a long string.

**Do not run that whole command on Ampere.** Do **not** run the Windows line `cloudflared.exe service install …` on the VM. We already installed the Linux binary. You only need the token string that follows `--token` (it starts with `eyJ` for most dashboard tunnels).

Leave this tab open. You will paste the token in G3.

## **5\. Session G2 — One published application route**

Open the **Healthy** Ampere tunnel (not a Down tunnel). The 2026 dashboard tabs are:

**Overview | CIDR routes | Hostname routes | Published application routes | Live logs**

Click **Published application routes** (older UI: **Public Hostnames**). You need **one** row. **Add** if empty.

| Field | What you type |
| :---- | :---- |
| Public hostname | e.g. `<TUNNEL_HOST>` (subdomain + your zone) |
| Path | `*` or empty — must cover `/`, `/auth/`, `/lab/dvwa/`, `/_next/static/`, `/api/ssh-websocket` |
| Type | **HTTP** (not HTTPS, not TCP, not SSH) |
| Service / URL | **`http://10.115.77.12:80`** exactly. No trailing path. |

**Never** set service to `localhost`, `:3000`, `https://…`, or the Oracle public IP `<PUBLIC_IP>`.  
Catch-all `http_status:404` under the row is normal.

Overview “Hostname” next to the connector (`cyberrange-vcn`) is the **Linux VM name**. That is **not** the student URL.

Save. Write down `https://<hostname>`. That is the only name you send the agent.

**Optional extra settings:** leave defaults. Do not turn on “Protect with Access” yet.

## **5b. Session G2b — DNS must point at THIS tunnel**

A published route is not enough. Cloudflare DNS for the hostname must target the **Healthy** tunnel.

1. Open [dash.cloudflare.com](https://dash.cloudflare.com) → your zone (`<YOUR_ZONE>`) → **DNS** → **Records**.  
2. Find the row for your subdomain.  
3. It must be a **Tunnel** / **CNAME** to the Ampere tunnel:

| Type | Name | Content / tunnel | Proxy |
| :---- | :---- | :---- | :---- |
| Tunnel or CNAME | your subdomain | the **Healthy** tunnel name, or `<TUNNEL_UUID>.cfargotunnel.com` | **Proxied** (orange) |

**530 / error 1033 while the connector is Healthy** almost always means DNS still points at a **Down** leftover tunnel. Edit the row to the Healthy tunnel. Do not touch apex/`www` A records for other sites.

Wait 30–60 seconds after save. Then G5.

**Do not** type `http://10.115.77.12` in Chrome on your PC. That address exists only inside the VM (`lxdbr0`). Timeout there is **expected**. Students use `https://<TUNNEL_HOST>`.

## **6\. Session G3 — Put the token on Ampere (SSH)**

On **your Windows PC**, open PowerShell and SSH:

```text
ssh ampere
```

Then, on the VM, paste the token **without** putting it in history:

```bash
sudo install -m 600 /dev/stdin /etc/cloudflared/token
```

- Paste **only** the token (one line).  
- Press **Enter**.  
- Press **Ctrl+D** (end of file).  
- Do not take a screenshot of this.

Lock permissions and start the service:

```bash
# Unit User=llms_admin MUST own the file. root:root 600 → permission denied, restart loop.
sudo chown -R llms_admin:llms_admin /etc/cloudflared
sudo chmod 700 /etc/cloudflared
sudo chmod 600 /etc/cloudflared/token
sudo ls -l /etc/cloudflared/token
# size must NOT be 0
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

**Done when:**

- `systemctl is-active cloudflared` prints `active`.  
- Cloudflare Tunnels page shows the connector **Healthy** (may take ~30 seconds).  
- `sudo ls -l /etc/cloudflared/token` size is **not** 0.

If `status` is `activating` then `failed`, the token is truncated or you pasted the whole `curl \| bash` install line. Recreate the token in the dashboard (tunnel → token / install command) and repeat G3. Do not `enable --now` on a 0-byte file.

**Do not** tell the agent the token. Tell the agent only:

> Tunnel Healthy. Student hostname is `https://lab.example.com` (your real name).

## **7\. Session G4 — HTTPS URL flip (Manual Chapter 07 Step 8)**

After the hostname exists, **you** edit `portal/.env.local` (merge, do not overwrite
the client secret). Typed table is Chapter 07 Step 8:

- `NEXTAUTH_URL=https://<your-host>`
- `KEYCLOAK_ISSUER` and `KEYCLOAK_PUBLIC_ISSUER` = `https://<your-host>/auth/realms/cyber-range`
- `KEYCLOAK_SERVER_SIDE_ISSUER` stays Path B (`http://10.115.77.12/auth/realms/cyber-range`)
- Keycloak client `portal` redirect URI `https://<your-host>/*` (keep Path B URIs)
- Introspect stays on **`http://10.115.77.12/auth/...`**
- Restart `cyberrange-portal.service`

## **8\. Session G5 — Internet probe (you, not on the VM)**

From **your PC** (home Wi‑Fi is fine; do **not** SSH-tunnel and then curl localhost). Replace the hostname and keep the public IP.

In PowerShell:

```powershell
$h = "https://lab.example.com"   # your hostname
$ip = "<PUBLIC_IP>"

curl.exe -sS -o NUL -w "login %{http_code}`n" --max-time 20 "$h/login"
curl.exe -sS -o NUL -w "oidc %{http_code}`n" --max-time 20 "$h/auth/realms/cyber-range/.well-known/openid-configuration"

foreach ($p in 80,443,3000,5000,18301) {
  curl.exe -sS -o NUL -w "${ip}:$p %{http_code} %{errormsg}`n" --connect-timeout 5 --max-time 8 "http://${ip}:$p/"
}
```

| URL | Pass |
| :---- | :---- |
| `https://<host>/login` | **200** or **302**. If you see a **white page with unstyled buttons**, that is still HTTP 200 — CSS failed (G5a). |
| `https://<host>/auth/realms/cyber-range/.well-known/openid-configuration` | **200**, `"issuer":"https://<host>/auth/realms/cyber-range"` |
| `https://<host>/_next/static/css/<hash>.css` | **200**, size **tens of KB**, body must **not** contain the text `@tailwind` |
| `http://<PUBLIC_IP>:80` | timeout / filtered (**000**) |
| `http://<PUBLIC_IP>:18301` | timeout / filtered |
| `http://<PUBLIC_IP>:3000` | timeout / filtered |
| `http://<PUBLIC_IP>:5000` | timeout / filtered |

If **any** of the last four print `200` or connect, **stop**. We opened a public port. Do not “fix” it by adding more Oracle rules. Tell the agent.

Paste the curl output (no cookies, no tokens) into evidence or chat.

## **8b. Session G5a — Login looks like raw HTML (this tenancy)**

If `/login` is **200** but you see a **white page**: “MMDC Cyber Range”, “Sign in”, grey default buttons, no maroon card — CSS never compiled.

Cause: `npm run build` without `portal/postcss.config.js` and `portal/tailwind.config.js`. The shipped CSS still contains `@tailwind` / `@apply`, which the browser ignores.

Manual later:

1. Those two files **must** sit next to `package.json` in the kit `cyberrange/portal` (or `~/cyberrange/portal` after copy) **before** `npm run build`.  
2. After build, `portal/.next/static/css/*.css` should be **~40 KB+** and must **not** contain the string `@tailwind`.  
3. Ship the new `.next` to Ampere, restart `cyberrange-portal`.  
4. Hard-refresh the browser: **Ctrl+Shift+R** (or a private window). Old HTML caches the old CSS filename.

## **9\. Session G6 — You log in as student over HTTPS**

In a **private** browser window:

1. Open `https://<your-host>/login` in a **private** window (**Ctrl+Shift+R** if you already had the unstyled page).  
2. You should see a **centred card**, MMDC mark, maroon **Continue with school SSO** — not a blank white document.  
3. Sign in with Keycloak as **student** (password is in `~/cyberrange-data/student.env` on the VM — copy it over SSH, do not paste it into the agent chat).  
4. You should land on **`/dashboard`**.  
5. Optional: Create one scenario pod, Open DVWA should be `/lab/dvwa/...` on the **same** hostname, Connect terminal `whoami` → `student`. Then **End Session** (destroys the pod).

If login bounces to `http://10.115.77.12` or `http://10.115.77.1:3000`, G4 did not finish — tell the agent the hostname again.

## **10\. Session G7 — Reboot persist (Task 14)**

Only after G5 login works.

On the VM:

```bash
sudo reboot
```

Wait ~2 minutes, then from your PC:

```text
ssh ampere
```

```bash
systemctl --user status cyberrange-provision-api cyberrange-portal cyberrange-ssh-bridge --no-pager
sudo systemctl status cloudflared --no-pager
curl -sS http://10.115.77.1:5000/health
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://10.115.77.12/auth/realms/cyber-range/.well-known/openid-configuration
```

**Pass:** all four units **active**; `/health` JSON ok; Path B `/auth/` **200**; Cloudflare still **Healthy**; `https://<host>/login` still 200/302 from your PC.

Then the agent may tick Task 14 and the L6 reboot box — **only** with this output.

## **11\. Pass / fail (do not call the range “student-ready” early)**

| Milestone | Pass |
| :---- | :---- |
| G3 | `cloudflared` **active**, dashboard connector **Healthy**, token file size **> 0** |
| G5 | HTTPS login/OIDC **200/302**; public IP website ports **timeout** |
| G6 | Student reaches `/dashboard` on **https://\<host\>/** |
| G7 | After reboot, API + portal + bridge + cloudflared still up |
| Student-ready | G5 **and** G6 **and** G7 recorded in evidence |

File-grade Scenario 09 can still PASS without SIEM rows. Do not block the tunnel on Wazuh dashboard.

## **12\. If you get stuck**

| Symptom | What to do |
| :---- | :---- |
| No domain in the hostname dropdown | Add the domain to Cloudflare DNS first (full or partial setup). Tunnels need a zone in **this** account. |
| Dashboard says “install cloudflared” and Debian commands | Ignore the package install. Copy **only** `--token`’s value. We already have `/usr/bin/cloudflared`. |
| `cloudflared` **failed** / restart loop | Token file empty, extra spaces, or **`root:root` while the unit is `User=llms_admin`**. Log: `Failed to read token file: permission denied`. `chown llms_admin` as in G3. `sudo wc -c /etc/cloudflared/token` must not be 0. |
| You ran `cloudflared.exe service install` on Ampere | Wrong OS. Ignore it. Use systemd + `/etc/cloudflared/token` (G3). |
| Connector stays **Inactive** | VM cannot reach the internet on 443 **out**. Oracle egress HTTPS must stay allowed (it should). Do not open **ingress** 443. |
| `https://host` **530** / **1033** while tunnel **Healthy** | DNS row for the subdomain still points at a **Down** leftover tunnel. Edit DNS → the **Healthy** tunnel. See G2b. |
| `https://host` **522** | Origin URL wrong. Must be `http://10.115.77.12:80`. guacamole RUNNING: `lxc list guacamole`. |
| Chrome `http://10.115.77.12` **ERR_CONNECTION_TIMED_OUT** | **Expected** from your PC. That IP is only on the VM. Use `https://<host>/login`. Do not open Oracle 80. |
| Login page is white unstyled HTML | G5a: Tailwind not compiled. Need `postcss.config.js` + `tailwind.config.js`, rebuild, hard-refresh. |
| Two tunnels, one **Down** | Student hostname DNS must use the **Healthy** Ampere tunnel only. |
| `https://host` **404** nginx welcome | nginx still on inherited `0.0.0.0:80`. That was Task 8; `ss` inside guacamole must show `10.115.77.12:80`. Tell the agent. |
| Login works then “redirect_uri mismatch” | Hostname not in Keycloak client redirects. Finish G4. |
| Browser shows Keycloak on `127.0.0.1:8083` | `KEYCLOAK_ISSUER` / public issuer still loopback. Agent must set public issuer to `https://<host>/auth/realms/cyber-range`. |
| You added Oracle port 80 “temporarily” | **Fail.** Remove that security-list row. Re-screenshot ingress. |
| Phone on mobile data cannot open the site | Good test (not on your home IP). If only your PC works, you may have Cloudflare Access or IP allowlists on — turn them off. |
| Token leaked in chat | Dashboard → tunnel → rotate/refresh token, repeat G3. |

## **13\. What you do right after this file**

1. Finish **G1–G3** (tunnel + hostname + token on the VM).  
2. Message the agent: **hostname is `https://….` Connector Healthy.** Do not send the token.  
3. The agent runs G4 (URL flip). You run G5–G6. Then G7 reboot together.

Oracle firewall stays **SSH-only**. The website is Cloudflare, not `http://<PUBLIC_IP>`.
