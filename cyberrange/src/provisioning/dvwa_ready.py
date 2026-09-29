"""DVWA schema + default security (no student setup.php)."""
from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

INIT_SQL_PATH = "/opt/vulnerable-apps/dvwa-init.sql"

# Probe: wait for mysqld then SHOW TABLES. No dump path in this argv (skip test).
_PROBE_SH = (
    "DB=$(docker ps -qf name=vulnerable-apps_db); "
    "[ -n \"$DB\" ] || exit 0; "
    "for i in 1 2 3 4 5 6; do "
    "docker exec \"$DB\" mysqladmin ping -udvwa -pp@ssw0rd --silent && break; "
    "sleep 5; "
    "done; "
    "docker exec \"$DB\" mysql -udvwa -pp@ssw0rd -N -e 'SHOW TABLES FROM dvwa' "
    "2>/dev/null || true"
)

_IMPORT_SH = (
    "DB=$(docker ps -qf name=vulnerable-apps_db); "
    "[ -n \"$DB\" ] || exit 0; "
    f"docker exec -i \"$DB\" mysql -udvwa -pp@ssw0rd dvwa < {INIT_SQL_PATH}"
)

_TOKEN = re.compile(
    r'name=["\']user_token["\'][^>]*value=["\']([^"\']+)["\']',
    re.I,
)
_LEVEL = re.compile(
    r"\$_DVWA\s*\[\s*['\"]default_security_level['\"]\s*\]\s*=\s*['\"](\w+)['\"]",
    re.I,
)


def users_table_present(show_tables_text: str) -> bool:
    return any(line.strip().lower() == "users" for line in (show_tables_text or "").splitlines())


def extract_setup_token(html: str) -> str | None:
    m = _TOKEN.search(html or "")
    return m.group(1) if m else None


def security_level_is_low(config_text: str) -> bool:
    m = _LEVEL.search(config_text or "")
    return bool(m and m.group(1).lower() == "low")


def patch_default_security_low(config_text: str) -> str:
    if security_level_is_low(config_text):
        return config_text
    if _LEVEL.search(config_text or ""):
        return _LEVEL.sub(
            "$_DVWA[ 'default_security_level' ] = 'low'",
            config_text,
            count=1,
        )
    return (config_text or "") + "\n$_DVWA[ 'default_security_level' ] = 'low';\n"


def _exec_out(inst: Any, argv: list[str], timeout: int = 180) -> tuple[int, str]:
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


# Patch default security inside the running DVWA container, then print the line.
# Non-zero when the container, config, or Low level is missing.
_SECURITY_LOW_SH = r"""
set -eu
DVWA=$(docker ps --format '{{.Names}}' | grep vulnerable-apps_dvwa | head -1)
[ -n "$DVWA" ]
CONF=$(docker exec "$DVWA" sh -c 'ls /var/www/html/config/config.inc.php /var/www/html/dvwa/config/config.inc.php 2>/dev/null | head -1')
[ -n "$CONF" ]
# Expand CONF on the LXC host before docker exec (do not pass literal $CONF into the container shell).
docker exec "$DVWA" sh -c "grep -q \"default_security_level' ] = 'low'\" '$CONF' || sed -i \"s/default_security_level.*/default_security_level' ] = 'low';/\" '$CONF'"
line=$(docker exec "$DVWA" grep -E "default_security_level" "$CONF" | head -1)
printf '%s\n' "$line"
printf '%s' "$line" | grep -qi "low"
"""


def ensure_dvwa_ready(inst: Any) -> bool:
    """Import DVWA schema if users table missing. Returns False if still missing."""
    try:
        _code, tables = _exec_out(inst, ["sh", "-c", _PROBE_SH])
        if not users_table_present(tables):
            dump_code, _ = _exec_out(inst, ["test", "-f", INIT_SQL_PATH])
            if dump_code == 0:
                inst.execute(["sh", "-c", _IMPORT_SH])
            else:
                _code, html = _exec_out(
                    inst,
                    [
                        "curl",
                        "-sS",
                        "-c",
                        "/tmp/dvwa.cj",
                        "-b",
                        "/tmp/dvwa.cj",
                        "-m",
                        "8",
                        "http://127.0.0.1/setup.php",
                    ],
                )
                token = extract_setup_token(html) or ""
                inst.execute(
                    [
                        "curl",
                        "-sS",
                        "-c",
                        "/tmp/dvwa.cj",
                        "-b",
                        "/tmp/dvwa.cj",
                        "-m",
                        "30",
                        "-X",
                        "POST",
                        "-d",
                        f"create_db=Create+%2F+Reset+Database&user_token={token}",
                        "http://127.0.0.1/setup.php",
                    ]
                )
            _code, tables = _exec_out(inst, ["sh", "-c", _PROBE_SH])
            if not users_table_present(tables):
                logger.warning("ensure_dvwa_ready: users table still missing")
                return False
        sec_code, sec_out = _exec_out(inst, ["sh", "-c", _SECURITY_LOW_SH])
        if sec_code != 0 or not security_level_is_low(sec_out):
            logger.warning("ensure_dvwa_ready: default security is not Low")
            return False
        return True
    except Exception as exc:
        logger.warning("ensure_dvwa_ready failed: %s", exc, exc_info=True)
        return False
