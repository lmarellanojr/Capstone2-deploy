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


def _exec_out(inst: Any, argv: list[str]) -> tuple[int, str]:
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


def ensure_dvwa_compose(inst: Any) -> bool:
    """Write official compose when db is missing. Fail-open (False)."""
    try:
        code, out = _exec_out(inst, ["cat", COMPOSE_PATH])
        text = out if code == 0 else ""
        if compose_missing_db(text):
            payload = official_dvwa_compose()
            inst.execute(["mkdir", "-p", "/opt/vulnerable-apps"])
            import base64

            b64 = base64.b64encode(payload.encode()).decode("ascii")
            inst.execute(
                ["sh", "-c", f"echo {b64} | base64 -d > {COMPOSE_PATH}"]
            )
        inst.execute(
            [
                "sh",
                "-c",
                # compose 1.29 often exits 0 after renaming/stopping dvwa (SIGWINCH)
                # and never binds :80. Fall back to docker run with DB_SERVER=db.
                "cd /opt/vulnerable-apps && (docker-compose up -d || docker compose up -d || true); "
                "if ! (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ':80 '; then "
                "docker rm -f vulnerable-apps_dvwa_1 44686fb3f49e_vulnerable-apps_dvwa_1 2>/dev/null || true; "
                "docker network create vulnerable-apps_default 2>/dev/null || true; "
                "docker run -d --name vulnerable-apps_dvwa_1 --network vulnerable-apps_default "
                "--restart unless-stopped -p 80:80 -e DB_SERVER=db ghcr.io/digininja/dvwa || true; "
                "fi",
            ]
        )
        return True
    except Exception as exc:
        logger.warning("ensure_dvwa_compose failed: %s", exc, exc_info=True)
        return False
