"""Static checks for guacamole nginx-ampere.conf (Issue #84)."""
from pathlib import Path
import re

CONF = Path(__file__).with_name("nginx-ampere.conf").read_text(encoding="utf-8")


def _location_spans(text: str):
    """Return list of (path, start_index) for location blocks."""
    return [
        (m.group(1), m.start())
        for m in re.finditer(r"location\s+(\S+)\s*\{", text)
    ]


def test_resources_location_exists():
    assert re.search(r"location\s+/resources/\s*\{", CONF), (
        "missing location /resources/"
    )


def test_resources_before_catch_all():
    spans = _location_spans(CONF)
    paths = [p for p, _ in spans]
    assert "/resources/" in paths
    assert "/" in paths
    assert paths.index("/resources/") < paths.index("/"), (
        "/resources/ must be declared before location /"
    )


def test_resources_proxies_to_keycloak_auth_resources():
    m = re.search(
        r"location\s+/resources/\s*\{(.*?)\n\s*\}",
        CONF,
        re.S,
    )
    assert m, "could not parse location /resources/"
    body = m.group(1)
    assert "proxy_pass http://keycloak/auth/resources/;" in body
    assert "X-Forwarded-Proto" in body
    assert "proxy_set_header Host $host;" in body


def test_auth_and_root_locations_still_present():
    assert re.search(r"location\s+/auth/\s*\{", CONF)
    assert re.search(r"location\s+/\s*\{", CONF)
    assert "listen 10.115.77.12:80;" in CONF


def test_keycloak_admin_api_without_auth_prefix():
    assert re.search(
        r"location\s+~\s+\^/admin/\(serverinfo\|realms\|master\)\(/\|\$\)\s*\{",
        CONF,
    ), "missing Keycloak-only /admin/(serverinfo|realms|master) location"
    m = re.search(
        r"location\s+~\s+\^/admin/\(serverinfo\|realms\|master\)\(/\|\$\)\s*\{(.*?)\n\s*\}",
        CONF,
        re.S,
    )
    assert m, "could not parse Keycloak /admin/ regex location"
    body = m.group(1)
    assert "rewrite ^/admin/(.*)$ /auth/admin/$1 break;" in body
    assert "proxy_pass http://keycloak;" in body
    # Must not blanket-proxy all /admin/ (portal uses /admin/pods, /admin/users).
    assert not re.search(r"location\s+/admin/\s*\{", CONF)


def test_realms_without_auth_prefix():
    assert re.search(r"location\s+/realms/\s*\{", CONF)
    m = re.search(r"location\s+/realms/\s*\{(.*?)\n\s*\}", CONF, re.S)
    assert m
    assert "proxy_pass http://keycloak/auth/realms/;" in m.group(1)
