#!/bin/bash
# AUTH-03: create the three prototype accounts (student_demo, instructor_demo,
# admin_demo) in the cyber-range realm, each with exactly one realm role
# (student / instructor / admin). Realm roles are what both the portal
# (decodes realm_access.roles client-side, see portal/src/lib/auth.ts) and the
# FastAPI backend (introspection response's realm_access.roles +
# resource_access.portal.roles, see provisioning/auth.py extract_roles())
# agree on -- so this script grants realm roles, not client roles.
#
# Idempotent: safe to re-run. Unlike create_keycloak_realm.sh this NEVER
# touches the portal client secret -- only realm roles and the three demo
# users. Passwords are generated fresh per run (temporary=false, so they don't
# force a change on first login) and written to a 600 file on the host; they
# are never echoed to stdout/logs.
#
# Run on the LXD host, as the provision-api operator, after
# create_keycloak_realm.sh has already created the cyber-range realm.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"
OUT_FILE=/home/llms_admin/cyberrange-data/demo-accounts.env

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }

STUDENT_PW="Dstu!$(openssl rand -hex 8)"
INSTRUCTOR_PW="Dins!$(openssl rand -hex 8)"
ADMIN_PW="Dadm!$(openssl rand -hex 8)"

umask 077
install -m 600 /dev/null /tmp/demo-seed.env
{
  echo "STUDENT_PW=${STUDENT_PW}"
  echo "INSTRUCTOR_PW=${INSTRUCTOR_PW}"
  echo "ADMIN_PW=${ADMIN_PW}"
} > /tmp/demo-seed.env
# Defensive: an earlier interrupted run can leave /tmp/admin.env or
# /tmp/demo-seed.env in the container owned by the exec-mapped uid, which
# `lxc file push` then fails to overwrite with "Error: Forbidden".
lxc exec guacamole -- rm -f /tmp/admin.env /tmp/demo-seed.env
lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc file push /tmp/demo-seed.env guacamole/tmp/demo-seed.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env /tmp/demo-seed.env
rm -f /tmp/demo-seed.env

lxc exec guacamole -- bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
. /tmp/demo-seed.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

# --- realm roles: student / instructor / admin (idempotent) ---
for role in student instructor admin; do
  kcadm.sh get "roles/$role" -r cyber-range >/dev/null 2>&1 || \
    kcadm.sh create roles -r cyber-range -s "name=$role"
done

create_or_update_user() {
  local username="$1" email="$2" first="$3" last="$4" role="$5" pw="$6"
  local uid
  uid=$(kcadm.sh get users -r cyber-range -q "username=$username" --fields id --format csv --noquotes 2>/dev/null | tail -1 || true)
  if [ -z "$uid" ] || [ "$uid" = "id" ]; then
    kcadm.sh create users -r cyber-range -s "username=$username" -s enabled=true -s "email=$email" \
      -s emailVerified=true -s "firstName=$first" -s "lastName=$last"
    uid=$(kcadm.sh get users -r cyber-range -q "username=$username" --fields id --format csv --noquotes | tail -1)
    echo "${username^^}_CREATED"
  else
    echo "${username^^}_EXISTS"
  fi
  # -t/--temporary is a boolean flag in this kcadm version (no "true"/"false"
  # argument accepted) -- omitting it means "not temporary", which is what we
  # want (create_keycloak_realm.sh's `--temporary false` is actually broken
  # on this kcadm version too; left alone here since it's out of AUTH-03 scope).
  kcadm.sh set-password -r cyber-range --username "$username" --new-password "$pw"

  # Strip any application roles this user already holds (student/instructor/admin)
  # so re-runs can't leave a demo account holding more than its one intended role.
  local current
  current=$(kcadm.sh get-roles -r cyber-range --uusername "$username" --fields name --format csv --noquotes 2>/dev/null || true)
  for existing in student instructor admin; do
    if [ "$existing" != "$role" ] && echo "$current" | grep -qx "$existing"; then
      kcadm.sh remove-roles -r cyber-range --uusername "$username" --rolename "$existing"
    fi
  done
  if ! echo "$current" | grep -qx "$role"; then
    kcadm.sh add-roles -r cyber-range --uusername "$username" --rolename "$role"
  fi
}

create_or_update_user student_demo    student_demo@local    Student    Demo    student    "$STUDENT_PW"
create_or_update_user instructor_demo instructor_demo@local Instructor Demo    instructor "$INSTRUCTOR_PW"
create_or_update_user admin_demo      admin_demo@local       Admin      Demo    admin      "$ADMIN_PW"

echo "=== role mapping verification (usernames + role names only) ==="
for u in student_demo instructor_demo admin_demo; do
  printf '%-16s' "$u"
  kcadm.sh get-roles -r cyber-range --uusername "$u" --fields name --format csv --noquotes | tr '\n' ' '
  echo
done

rm -f /tmp/admin.env /tmp/demo-seed.env
echo DEMO_ACCOUNTS_OK
INNER

umask 077
printf 'STUDENT_DEMO_PASSWORD=%s\nINSTRUCTOR_DEMO_PASSWORD=%s\nADMIN_DEMO_PASSWORD=%s\n' \
  "$STUDENT_PW" "$INSTRUCTOR_PW" "$ADMIN_PW" > "$OUT_FILE"
chmod 600 "$OUT_FILE"
echo "credentials written to $OUT_FILE (not printed)"
echo TASK_AUTH03_DEMO_ACCOUNTS_DONE
