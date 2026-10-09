## Scenario 2: SQL Injection & Reflected XSS

> **Where to work:** the embedded DVWA browser panel. Tasks 1–4 auto-score from DVWA responses; Task 5 requires flag submission.

Offensive · 5 tasks · 350 points · no terminal needed.

## 0. Before you start: the big picture

**DVWA** (Damn Vulnerable Web Application) is a deliberately vulnerable practice website. Work entirely in the browser: establish a normal result, change a database query through input, read the database name, retrieve the admin hash, demonstrate reflected script execution, and submit the lab flag.

A **payload** is the input you supply to test a behavior. **SQL injection** means input changes the structure or meaning of a database query. **Reflected XSS** (Cross-Site Scripting) means the site includes submitted input in its response and the browser can interpret it as script. A **flag** is a lab value you find and submit to prove completion.

Tasks 1–3 use **User ID** on **SQL Injection**. Tasks 4–5 use **What's your name?** on **XSS (Reflected)**. Tasks 1–4 are automatic; the final task is submitted in the portal. Keep all exploration within your assigned lab.

## 1. The website and payload syntax

Set **DVWA Security** to **Low** for this lab. A normal ID is placed inside a query that asks for two name values. The illustrative query is `SELECT first_name, last_name FROM users WHERE user_id = 'YOUR INPUT';` — explanation only, not a command to run.

A single quote closes the input's quoted string. `OR '1'='1` adds an always-true condition. A **UNION SELECT** joins additional results to the original query and must supply the same number of values: two here. `null` supplies an empty value.

| Task | Existing navigation title | Points |
| --- | --- | --- |
| 1 | Injection Point | 50 |
| 2 | Database Extraction | 75 |
| 3 | Admin Hash | 100 |
| 4 | Reflected XSS | 75 |
| 5 | Capture the Flag | 50 |

## 2. How scoring works

The portal checks your request and DVWA's successful response, rather than grading your screen. Task 1 accepts an always-true payload returning multiple rows, or a quote-triggered SQL syntax error. The required path below uses multiple rows. Task 2 checks metadata input and a returned database-name value. Task 3 checks a users-table UNION response containing a 32-character hexadecimal hash. Identify the admin row yourself; the detector does not verify that interpretation.

Task 4 checks a submitted script tag reflected in the response; it does **not** observe the popup itself. The popup is your separate evidence of execution. Task 5 checks the flag you submit and is not automatic.

If pending, check **Low**, the correct module and field, and the actual result before resubmitting. Avoid using **Manual Check** as a refresh button: where available, you get one per task and an unsuccessful check moves the task to instructor review.

## 3. Set up your lab

1. Start **SQL Injection** and wait for **ACTIVE**. DVWA appears inside the lab page; **Open in new tab** is available if preferred.
2. Log in to DVWA with lab username `admin` and password `password`. If it shows database setup instead of the menu, ask your instructor to check the lab.
3. Select **DVWA Security**, choose **Low**, and select **Submit**. Confirm the displayed security level.
4. Select **SQL Injection** above the DVWA panel. Use **User ID** for Tasks 1–3.

## 4. Do the tasks

### Task 1: Injection Point

**Goal:** demonstrate that input changes the database query's behavior.

**Where to work:** **SQL Injection**, **User ID** in the DVWA panel.

1. Enter normal ID `1`, select **Submit**, and note the single user's result as your baseline.
2. In DVWA's **User ID** field, paste this payload and select **Submit**:

```text
1' OR '1'='1
```

3. Compare the returned rows with the baseline. The added condition `'1'='1'` is always true, allowing additional user rows to be returned.

**Expected result:** multiple **First name** / **Surname** pairs appear instead of just user 1. A syntax error is another accepted scoring signal, but not the intended result of this payload.

**Done when:** you can explain the baseline-to-multiple-rows change and **Injection Point** is credited. In this lab you demonstrated access to additional user records, not unrestricted access to all server data.

> **Troubleshooting:** Confirm **Low**, **SQL Injection**, and the single quotes. If only one row appears, replace the whole field with the shown payload and submit again.

### Task 2: Database Extraction

**Goal:** find the current database name.

**Where to work:** **SQL Injection**, **User ID** in DVWA.

1. In DVWA's **User ID** field, paste and select **Submit**:

```text
1' UNION SELECT null, database() -- -
```

2. Find the added result's **Surname** value. `database()` returns the current database name. The two supplied values, `null` and `database()`, match the original query's two columns.
3. Check the delimiter: `-- -` is **dash, dash, space, dash**. The space matters; the comment prevents DVWA's remaining quote from breaking the injected query.

**Expected result:** an added row shows `dvwa` in **Surname**. The ordinary user 1 row can still appear as well.

**Done when:** you identify the database name and **Database Extraction** is credited. The existing navigation title remains Database Extraction; this task's required result is the name.

> **Troubleshooting:** A column-count error means the UNION did not supply exactly two values. A syntax error can mean a missing single quote or the missing space in `-- -`.

**Optional:** after the required path, select **PDF** beside the walkthrough to open the complete guide, including **Payload playground**. `1' UNION SELECT user(), database() -- -` also returns the database account; it is not required for completion.

### Task 3: Admin Hash

**Goal:** retrieve and identify the admin password hash.

**Where to work:** **SQL Injection**, **User ID** in DVWA.

1. In DVWA's **User ID** field, paste and select **Submit**:

```text
1' UNION SELECT user, password FROM users -- -
```

2. Find the added row whose **First name** value is `admin`. For these injected rows, **First name** displays the selected username and **Surname** displays its password hash; those labels do not describe the injected values.
3. Identify the admin row's 32-character hexadecimal hash. A **hash** is a one-way derived value used to check passwords; it is not plaintext or reversible encryption. Weak passwords and fast hashes can still be guessed by comparing candidate hashes.

**Expected result:** username/hash pairs appear, including the admin account. Existing ordinary name rows may also appear; distinguish them from the injected pairs.

**Done when:** you identify the admin username and its corresponding hash and **Admin Hash** is credited. The checker sees a returned hash; your row identification supplies the learning evidence.

**Why it matters:** the lab demonstrates why password storage needs protection from injection and suitable password hashing. Select **PDF** beside the walkthrough for the complete guide's **Payload playground**; cracking-tool exploration is not required here.

### Task 4: Reflected XSS

**Goal:** demonstrate that reflected input can execute a script in the DVWA result page.

**Where to work:** select **XSS (Reflected)** above DVWA; use **What's your name?**.

1. Switch from **SQL Injection** to **XSS (Reflected)**. This task changes browser behavior, rather than a database query.
2. In DVWA's **What's your name?** field, paste and select **Submit**:

```text
<script>alert(1)</script>
```

3. Observe the popup containing `1`, then dismiss it with **OK** before continuing. **Reflected** means this response includes the input you just submitted; it is not saved as a stored message for later visitors.

**Expected result:** the popup demonstrates script execution in this lab page. The portal's separate scoring signal is the script tag reflected in DVWA's response, not direct observation of execution.

**Done when:** you observe and dismiss the popup and **Reflected XSS** is credited.

> **Troubleshooting:** Check **Low**, the correct module and field, and the exact script tags. A credited task without a popup does not prove execution; browser dialog settings may affect what you see. The lab's sandbox isolates the vulnerable page from portal cookies, so this demonstration does not establish access to the portal session.

### Task 5: Capture the Flag

**Goal:** read your lab's capture code and submit it in the portal.

**Where to work:** **XSS (Reflected)** in DVWA, then **Capture the Flag** in task navigation and its **Status** area.

1. If needed, repeat Task 4's payload in the DVWA **What's your name?** field and select **Submit**:

```text
<script>alert(1)</script>
```

2. Dismiss the popup with **OK**. Scroll **inside the DVWA result page** and find **Your capture-the-flag code:**. This lab's Low-security page reveals the planted code for nonempty name input; the code itself is not evidence that a script executed.
3. Read your actual code. **Example only — do not submit this:** `brave-otter-7421` illustrates the two-words-and-four-digits format; it is not your answer.
4. Select **Capture the Flag** in the portal's task navigation. While incomplete, enter your code in **Submit the flag you found** under **Status** and select **Submit**.

**Expected result:** a correct code is accepted and points are awarded. A wrong code displays feedback without completing the task. Preserve hyphens and digits. Capitalization and surrounding whitespace are normalized; copying the displayed code exactly is simplest.

**Done when:** **Capture the Flag** is credited. The submission field disappears after completion. All five tasks total **350 points**.

> **Troubleshooting:** If no code appears, check **Low**, nonempty input, and **XSS (Reflected)**; scroll the DVWA page rather than the Guide. If the result has no code after these checks, ask your instructor to check flag setup. Do not guess or submit the example.

## 5. Payload playground (optional, not required for scoring)

After all five required tasks, compare these inputs only in your lab:

| DVWA field | Optional input | Observation to compare |
| --- | --- | --- |
| SQL Injection: User ID | `1'` | A quote can cause a SQL syntax error. |
| SQL Injection: User ID | `1' UNION SELECT user(), database() -- -` | Database account and database name. |
| SQL Injection: User ID | `1' UNION SELECT user(), @@version -- -` | Database account and server version. |
| XSS (Reflected): What's your name? | `<b>bold</b>` | Markup rendering, without establishing script execution. |
| XSS (Reflected): What's your name? | `<script>alert(document.domain)</script>` | Browser context of the vulnerable page; dismiss the popup. |

Optional offline password-guessing tools compare candidate hashes; no cracking is required to complete **Admin Hash**. Do not send lab hashes to external lookup services as part of the required workflow.
