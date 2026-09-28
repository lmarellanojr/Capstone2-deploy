"""DVWA docker-compose helper (Ampere-transferable).

Official DigiNinja image is PHP/Apache only. App-only compose → mysqli
connection refused on 127.0.0.1:3306.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

COMPOSE_PATH = "/opt/vulnerable-apps/docker-compose.yml"

OFFICIAL_COMPOSE = """version: "3"
services:
  dvwa:
    image: ghcr.io/digininja/dvwa
    restart: always
    ports: ["80:80"]
    environment:
      - DB_SERVER=db
    depends_on:
      - db
  db:
    image: docker.io/library/mariadb:10
    restart: always
    environment:
      - MYSQL_ROOT_PASSWORD=dvwa
      - MYSQL_DATABASE=dvwa
      - MYSQL_USER=dvwa
      - MYSQL_PASSWORD=p@ssw0rd
"""


def compose_missing_db(text: Optional[str]) -> bool:
    if not text:
        return True
    lower = text.lower()
    has_db_svc = "\n  db:" in text or text.startswith("  db:") or "\ndb:" in f"\n{text}"
    # official key: service named db plus image mariadb, or DB_SERVER=db
    if "mariadb" in lower and "db_server=db" in lower:
        return False
    if has_db_svc and "mariadb" in lower:
        return False
    return True


def official_dvwa_compose() -> str:
    return OFFICIAL_COMPOSE


def _exec_out(inst: Any, argv: list[str], timeout: int = 180) -> tuple[int, str]:
    # Health waits (MariaDB + PHP mysqli + login form) can exceed pylxd defaults.
    try:
        raw = inst.execute(argv, timeout=timeout)
    except TypeError:
        raw = inst.execute(argv)
    if isinstance(raw, tuple) and len(raw) >= 2:
        code, out = raw[0], raw[1]
        if isinstance(out, bytes):
            out = out.decode("utf-8", "replace")
        return int(code), str(out)
    code = int(getattr(raw, "exit_code", 1))
    out = getattr(raw, "stdout", "") or ""
    if isinstance(out, bytes):
        out = out.decode("utf-8", "replace")
    return code, out


# Port 80 listening is not enough: compose 1.29 can leave a hash-prefixed
# DVWA container bound on :80 without DB_SERVER=db.
ENSURE_COMPOSE_SH = r"""
set -eu
cd /opt/vulnerable-apps
ids=$(docker ps -aq --filter name=vulnerable-apps_dvwa || true)
if [ -n "$ids" ]; then
  docker rm -f $ids || true
fi
docker network create vulnerable-apps_default >/dev/null 2>&1 || true
if ! docker ps --format '{{.Names}}' | grep -qx vulnerable-apps_db_1; then
  docker rm -f vulnerable-apps_db_1 >/dev/null 2>&1 || true
  docker run -d --name vulnerable-apps_db_1 --restart always \
    --network vulnerable-apps_default --network-alias db \
    -e MYSQL_ROOT_PASSWORD=dvwa \
    -e MYSQL_DATABASE=dvwa \
    -e MYSQL_USER=dvwa \
    -e MYSQL_PASSWORD='p@ssw0rd' \
    docker.io/library/mariadb:10 >/dev/null
else
  docker network connect --alias db vulnerable-apps_default vulnerable-apps_db_1 >/dev/null 2>&1 || true
fi
ok=0
for _i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if docker exec vulnerable-apps_db_1 mysqladmin ping -udvwa -pp@ssw0rd --silent; then
    ok=1
    break
  fi
  sleep 2
done
[ "$ok" = 1 ]
docker rm -f vulnerable-apps_dvwa_1 >/dev/null 2>&1 || true
docker run -d --name vulnerable-apps_dvwa_1 --restart always \
  --network vulnerable-apps_default \
  -e DB_SERVER=db -p 80:80 \
  ghcr.io/digininja/dvwa >/dev/null
ready=0
for _j in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec vulnerable-apps_dvwa_1 printenv DB_SERVER 2>/dev/null | grep -qx db; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ]
# Wait until PHP can open MySQL on hostname db (DNS + mysqli), then require a
# real DigiNinja login form. Empty/failed curl is not success.
php_ok=0
for _j in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if docker exec vulnerable-apps_dvwa_1 php -r 'try { new mysqli("db","dvwa","p@ssw0rd","dvwa",3306); exit(0);} catch (Throwable $e) { exit(1); }'; then
    php_ok=1
    break
  fi
  sleep 2
done
[ "$php_ok" = 1 ]
login_ok=0
body=
for _j in 1 2 3 4 5 6 7 8 9 10 11 12; do
  body=$(curl -fsS -m 8 http://127.0.0.1/login.php 2>/dev/null || true)
  if printf '%s' "$body" | grep -qiE 'Connection refused|mysqli_sql_exception'; then
    sleep 2
    continue
  fi
  if [ -n "$body" ] && printf '%s' "$body" | grep -qi 'user_token' && printf '%s' "$body" | grep -qi 'Login'; then
    login_ok=1
    break
  fi
  sleep 2
done
[ "$login_ok" = 1 ]
printf '%s' "$body"
exit 0
"""


def login_body_is_db_failure(body: str) -> bool:
    lower = (body or "").lower()
    return "connection refused" in lower or "mysqli_sql_exception" in lower


def login_body_has_form(body: str) -> bool:
    """Positive signal: non-empty DigiNinja login HTML, not merely 'no error yet'."""
    text = body or ""
    if not text.strip():
        return False
    if login_body_is_db_failure(text):
        return False
    lower = text.lower()
    return "user_token" in lower and "login" in lower


def ensure_dvwa_compose(inst: Any) -> bool:
    """Write official compose when db is missing, then start a healthy stack.

    Returns False if MariaDB is unreachable, curl never returns a login form,
    or the page shows a mysqli connection failure. Port 80 alone is not success.
    """
    try:
        code, out = _exec_out(inst, ["cat", COMPOSE_PATH])
        text = out if code == 0 else ""
        if compose_missing_db(text):
            payload = official_dvwa_compose()
            inst.execute(["mkdir", "-p", "/opt/vulnerable-apps"])
            import base64

            b64 = base64.b64encode(payload.encode()).decode("ascii")
            inst.execute(["sh", "-c", f"echo {b64} | base64 -d > {COMPOSE_PATH}"])
        probe_code, probe_out = _exec_out(inst, ["sh", "-c", ENSURE_COMPOSE_SH])
        if (
            probe_code != 0
            or login_body_is_db_failure(probe_out)
            or not login_body_has_form(probe_out)
        ):
            logger.warning(
                "ensure_dvwa_compose unhealthy code=%s", probe_code
            )
            return False
        return True
    except Exception as exc:
        logger.warning("ensure_dvwa_compose failed: %s", exc, exc_info=True)
        return False
