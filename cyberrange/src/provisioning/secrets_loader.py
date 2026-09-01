"""Unified secret resolution for the provision API (env today, Vault later).

Precedence: process environment → optional SECRETS_FILE (dotenv-like KEY=value).
If VAULT_ADDR and VAULT_SECRET_PATH are both set, fail closed — Vault backend is
not implemented in this sprint (TRB condition 8).
"""
from __future__ import annotations

import os
from pathlib import Path


class SecretsConfigError(RuntimeError):
    """Raised when a required secret is missing or Vault is misconfigured."""


def _load_secrets_file() -> dict[str, str]:
    path = os.getenv("SECRETS_FILE", "").strip()
    if not path:
        return {}
    p = Path(path)
    if not p.is_file():
        raise SecretsConfigError(f"SECRETS_FILE not found: {path}")
    out: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def get_secret(
    name: str,
    *,
    required: bool = True,
    default: str | None = None,
) -> str | None:
    """Resolve a named secret. Never log the returned value."""
    if os.getenv("VAULT_ADDR") and os.getenv("VAULT_SECRET_PATH"):
        # Stub: do not silently fall back if operator enabled Vault mode.
        raise SecretsConfigError(
            "VAULT_ADDR/VAULT_SECRET_PATH set but Vault backend not implemented "
            "in this sprint; unset them or use the SECRETS_FILE env var"
        )
    val = os.environ.get(name)
    if val is None or val == "":
        val = _load_secrets_file().get(name)
    if val is None or val == "":
        if required and default is None:
            raise SecretsConfigError(f"required secret {name} is not set")
        return default
    return val
