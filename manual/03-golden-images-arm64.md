# Chapter 03: Golden Images (aarch64)

Bake the three golden images every student pod is cloned from.

---

## Before you start: RAM, and chapter order

Baking runs three builder containers and a full `apt` install each. On the 12 GiB
shape that does **not** fit alongside `guacamole` and `wazuh-manager`.

- **If you have not done Chapter 02 yet** — good. Bake now, then go back.
- **If you already did Chapter 02** — stop those containers first:

```bash
lxc stop guacamole wazuh-manager 2>/dev/null || true
lxc list -c ns
```

Restart them after the bake completes:

```bash
lxc start guacamole wazuh-manager
```

The live host baked goldens **before** guacamole and Wazuh existed. If you skip
this, the bake fails partway through on memory pressure and leaves half-built
builder containers behind.

---

## What gets built

Three images, in three stages. The first stage builds all three bases; the second
and third rebake two of them in place.

| Stage | Command | Produces |
|---|---|---|
| 1 | `oci_build_goldens_arm64.sh` | `kali-base`, `meta-base`, `dvwa-base` |
| 2 | `bake_wazuh_agent.sh meta-base` | `meta-base` + wazuh-agent 4.7.5 (pinned to the manager) |
| 3 | `bake_dvwa_ready.sh` | `dvwa-base` + DVWA database initialised, security low |

> **The image aliases are `kali-base`, `meta-base` and `dvwa-base`.** There is no
> `kali:golden`. In LXD, `name:alias` means *remote server `name`*, so
> `lxc launch kali:golden` tries to contact a remote called `kali` and fails.

Stages 2 and 3 each leave a dated rollback alias — `meta-base-prewazuh-YYYYMMDD`
and `dvwa-base-predvwaready-YYYYMMDD` — so a bad rebake can be reverted without
rebuilding from scratch.

---

## Step 0: Confirm the OCI packet filter is in place

Chapter 01 installed `install_lxd_oci_iptables.sh`. Builder containers cannot
`apt-get` without it — they come up with `eth0` UP, **0 bytes RX** and
`Network is unreachable` — so confirm it before spending an hour on a bake.

```bash
systemctl is-active cyberrange-lxd-iptables.service     # -> active
sudo iptables -L FORWARD -n | grep -c lxdbr0            # -> at least 1
```

If either check fails, go back and run it — it belongs to the host, not to this
chapter:

```bash
sudo bash ~/cyberrange/deploy/host/install_lxd_oci_iptables.sh
```

Then prove a container can actually reach the internet:

```bash
lxc init ubuntu:22.04 nettest </dev/null
lxc start nettest </dev/null
sleep 15
lxc exec nettest -- ping -c2 1.1.1.1
lxc delete -f nettest </dev/null
```

If that ping fails, stop. Nothing below will work.

---

## Step 1: Bake the three bases

```bash
cd ~/cyberrange
REPO=$HOME/cyberrange PHASE3=$HOME/cyberrange/deploy/golden/phase3 \
  bash deploy/oci_build_goldens_arm64.sh
```

> **`REPO` is not optional.** The script defaults to `REPO=$HOME/cyber-range`
> — with a hyphen — which is the old repo name. This Manual clones to
> `~/cyberrange`, so without the override the script exits immediately with
> `[!] Missing /home/llms_admin/cyber-range/deploy/golden/phase3`.

> **The script takes no arguments.** It builds meta, then kali, then dvwa in one
> run. Passing `kali` or `meta` does nothing — the argument is ignored and all
> three are built anyway. Each `build_*` function skips itself if its image
> already exists, so re-running after a failure resumes rather than rebuilding.

Expect roughly half an hour, and budget an hour. On the live host the whole of
Task 5 — all three stages plus diagnosing the Step 0 filter problem — took 51
minutes wall clock. Expected progress lines:

```text
=== OCI ARM64 golden build (repo: /home/llms_admin/cyberrange) ===
[*] Creating meta ARM64 builder (init+start)...
[*] Publishing meta-base from meta-build...
[+] meta-base published.
[*] Creating Kali ARM64 builder (init+start)...
[*] Publishing kali-base from kali-build...
[+] kali-base published.
[*] Creating DVWA ARM64 builder (init+start)...
[*] Publishing dvwa-base from dvwa-build...
[+] dvwa-base published.
=== Done ===
```

### Student accounts are baked automatically — do not add them by hand

The build already creates the lab logins, in the right order:

| Image | Account | Created by |
|---|---|---|
| `kali-base` | `student` / `student` | `kali_add_student.sh`, run **before** the history flush |
| `meta-base` | `msfadmin` / `msfadmin` | `meta_add_msfadmin.sh` |
| `dvwa-base` | none, by design | — DVWA is used from the browser and from Kali, not by shell |

`kali_add_student.sh` must run before `enable_history_flush.sh` so that
`/home/student` exists for the flush to patch. The build script does this for you.
An earlier ARM64 bake ran the flush **without** the student script, and the first
student pod failed with `su: user student does not exist`.

The `student` and `msfadmin` passwords are deliberately simple fixed lab
credentials, not secrets. `student` gets **no** sudo in the golden — the
provisioner grants it per-pod at provision time.

---

## Step 2: Bake the Wazuh agent onto `meta-base`

Do this only if you are using the Wazuh scoring path (Chapter 06). It is optional.

**Preflight — no student pods may be running:**

```bash
lxc list --format csv -c n | grep '^pod-student-' && echo "DESTROY THESE FIRST" || echo "clear"
```

```bash
cd ~/cyberrange
bash deploy/golden/bake_wazuh_agent.sh meta-base
```

The agent version is pinned to **4.7.5** inside `bake_wazuh_agent.sh`, matching
the manager pinned in Chapter 02 Step 4b. Neither chapter depends on the other
having run — both pin the same literal — but if you change one, change both.

The clone runs on the `default` profile deliberately — `pod-target-base` has
`ipv4_filtering` on and no egress, so `apt` would fail there.

Rollback alias created: `meta-base-prewazuh-YYYYMMDD`.

---

## Step 3: Bake DVWA into a ready state

```bash
cd ~/cyberrange
bash src/provisioning/bake_dvwa_ready.sh
```

This clones `dvwa-base`, starts Docker with nesting, brings up the official
compose stack with `DB_SERVER=db`, creates and populates the DVWA database, sets
security to **low**, and republishes.

Without this stage every student pod lands on DVWA's `setup.php` and has to
initialise the database by hand before Scenario 06 can start.

> **`docker-compose` 1.29 may print `KeyError: ContainerConfig`** while recreating
> the service, because the image is already present from the base bake. The script
> continues past it deliberately. It is only a real failure if the checks below
> fail — MariaDB reporting `mysqld is alive` and `SHOW TABLES` listing `users` are
> the conditions the script requires before it publishes.

Rollback alias created: `dvwa-base-predvwaready-YYYYMMDD`.

---

## Step 4: Verify

### The images exist, with sane sizes

```bash
lxc image list
```

Expect three aliases plus the two dated rollback aliases. Reference sizes from the
live host:

| Alias | Size | Notes |
|---|---|---|
| `kali-base` | ~4.5 GiB | kali-rolling arm64, ssh enabled, `student` present |
| `meta-base` | ~600 MiB | wazuh-agent 4.7.5 held |
| `dvwa-base` | ~1.0 GiB | description ends `DVWA db ready, security low` |

### Disk

```bash
lxc storage info default
```

```text
driver: btrfs
total space: 150.00GiB
space used: 6.46GiB
```

**All three goldens together are about 6.5 GiB**, not hundreds. If `space used` is
in the tens of GiB after a bake, you have leftover builder containers — check
`lxc list` for `kali-build`, `meta-build`, `dvwa-build` or `bake-*` and delete
them.

### Test-launch a pod from the Kali golden

```bash
lxc init kali-base test-kali </dev/null
lxc start test-kali </dev/null
sleep 15

lxc exec test-kali -- su - student -c 'whoami'      # → student
lxc exec test-kali -- getent passwd student

lxc delete -f test-kali </dev/null
```

> Use `lxc init` + `lxc start` with stdin closed, not `lxc launch`. On the LXD
> 5.21 snap, `lxc launch` hangs indefinitely when stdin is a TTY — the same hang
> that affects `lxc profile create` and `lxc network peer create`. See Chapter 09,
> Issue 1.

`whoami` returning `student` is the single check that would have caught the
first-pod failure on the live host. Do not skip it.

### Confirm the builders are gone

```bash
lxc list -c ns
```

No `*-build` or `bake-*` containers should remain. The build script deletes them
on success; a failed run may leave one behind.

---

## Rebuilding a single image

Each `build_*` function skips when its alias already exists, so to rebuild just
one, delete that alias first:

```bash
lxc image delete kali-base
REPO=$HOME/cyberrange PHASE3=$HOME/cyberrange/deploy/golden/phase3 \
  bash deploy/oci_build_goldens_arm64.sh
```

Destroy any student pods before deleting an image they were cloned from.

---

**Next:** Chapter 04 — Core Services
