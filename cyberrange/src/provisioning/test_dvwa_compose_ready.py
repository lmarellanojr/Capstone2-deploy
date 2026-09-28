"""Issue #124: DVWA compose must include MariaDB, and ready must re-probe users."""

from dvwa_compose import (
    ENSURE_COMPOSE_SH,
    compose_missing_db,
    ensure_dvwa_compose,
    login_body_is_db_failure,
    official_dvwa_compose,
)
from dvwa_ready import (
    ensure_dvwa_ready,
    patch_default_security_low,
    security_level_is_low,
    users_table_present,
)


APP_ONLY = (
    'version: "3"\nservices:\n  dvwa:\n'
    "    image: ghcr.io/digininja/dvwa\n    ports: [\"80:80\"]\n"
)


class FakeInst:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def execute(self, argv):
        self.calls.append(list(argv))
        if not self.responses:
            return (0, "")
        return self.responses.pop(0)


def test_official_compose_has_db_server_and_mariadb():
    text = official_dvwa_compose()
    assert "DB_SERVER=db" in text
    assert "mariadb" in text.lower()
    assert compose_missing_db(text) is False


def test_app_only_compose_is_missing_db():
    assert compose_missing_db(APP_ONLY) is True
    assert compose_missing_db("") is True
    assert compose_missing_db(None) is True


def test_login_body_db_failure():
    assert login_body_is_db_failure("Fatal mysqli_sql_exception: Connection refused")
    assert login_body_is_db_failure("ok login form") is False


def test_users_table_present():
    assert users_table_present("guestbook\nusers\n") is True
    assert users_table_present("guestbook\n") is False


def test_patch_default_security_low():
    raw = (
        "$_DVWA[ 'default_security_level' ] = "
        "getenv('DEFAULT_SECURITY_LEVEL') ?: 'impossible';"
    )
    out = patch_default_security_low(raw)
    assert security_level_is_low(out)


def test_ensure_compose_script_replaces_all_dvwa_and_requires_db_server():
    assert "--filter name=vulnerable-apps_dvwa" in ENSURE_COMPOSE_SH
    assert "--network-alias db" in ENSURE_COMPOSE_SH
    assert "DB_SERVER=db" in ENSURE_COMPOSE_SH
    assert "Connection refused|mysqli_sql_exception" in ENSURE_COMPOSE_SH
    assert "grep -q ':80 '" not in ENSURE_COMPOSE_SH


def test_ensure_compose_returns_false_when_health_script_fails():
    inst = FakeInst(
        [
            (0, APP_ONLY),  # cat compose
            (0, ""),  # mkdir
            (0, ""),  # write compose
            (1, "Connection refused"),  # ensure script
        ]
    )
    assert ensure_dvwa_compose(inst) is False
    scripts = [c[2] for c in inst.calls if c[:2] == ["sh", "-c"]]
    assert any("vulnerable-apps_dvwa" in s and "DB_SERVER=db" in s for s in scripts)


def test_ensure_compose_returns_true_when_health_script_ok():
    inst = FakeInst(
        [
            (0, official_dvwa_compose()),
            (0, "<html>Login</html>"),
        ]
    )
    assert ensure_dvwa_compose(inst) is True


def test_ensure_ready_returns_false_when_users_still_missing():
    inst = FakeInst(
        [
            (0, "guestbook\n"),  # probe
            (1, ""),  # no init sql
            (0, "<input name='user_token' value='abc'>"),
            (0, ""),  # setup post
            (0, "guestbook\n"),  # re-probe still missing
        ]
    )
    assert ensure_dvwa_ready(inst) is False


def test_ensure_ready_imports_then_confirms_users():
    inst = FakeInst(
        [
            (0, ""),  # probe empty
            (0, ""),  # init sql exists
            (0, ""),  # import
            (0, "users\nguestbook\n"),  # re-probe
            (0, ""),  # security low
        ]
    )
    assert ensure_dvwa_ready(inst) is True
    scripts = [c[2] for c in inst.calls if len(c) >= 3 and c[0] == "sh"]
    assert any("dvwa-init.sql" in s for s in scripts)
