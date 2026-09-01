#!/bin/bash
# kali_add_student.sh — create the student login account on the kali golden.
# Idempotent. Run INSIDE the container (e.g. `lxc exec <container> -- bash -s < ...`).
# student/student are FIXED LAB CREDS by design (intentionally simple, not
# secrets) — matches meta_add_msfadmin.sh's msfadmin/msfadmin convention.
#
# Historically this account was "baked into kali-base out-of-band" by a manual
# step outside any committed script (see phase3_build_kali.sh's prior note) —
# that step was never performed when this repo's ARM64 golden was rebuilt,
# leaving kali-base with no student user at all. This script replaces that
# out-of-band step with a committed, reproducible one.
#
# NOT granted sudo here, by the same design as msfadmin: provision.py grants
# 'student ALL=(ALL) NOPASSWD:ALL' per-pod at provision time (see
# src/provisioning/provision.py), not baked into the golden. Do not add sudo
# here.
#
# Must run BEFORE enable_history_flush.sh in the build sequence, so the
# student home directory exists for that script to patch.
set -e
if id student >/dev/null 2>&1; then
  echo "student exists; ensuring shell"
  usermod -s /bin/bash student
else
  useradd -m -s /bin/bash student
fi
echo 'student:student' | chpasswd
echo "RESULT: $(getent passwd student) | groups=$(id -nG student | tr ' ' ',')"
