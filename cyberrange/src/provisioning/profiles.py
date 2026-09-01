"""Deployment profile registry for provisioning defaults."""
import os
from dataclasses import dataclass


class UnknownProfileError(RuntimeError):
    """Raised when an unknown profile name is requested."""


@dataclass(frozen=True)
class Profile:
    """Immutable deployment profile with capacity and operational defaults."""

    name: str
    max_pods: int
    pod_ram_mb: int
    ram_buffer_mb: int
    pod_storage_mb: int
    storage_limit_mb: int
    wazuh_mode: str
    keycloak_mode: str


PROFILES: dict[str, Profile] = {
    "onprem": Profile(
        name="onprem",
        max_pods=3,
        pod_ram_mb=4096,
        ram_buffer_mb=2048,
        pod_storage_mb=7168,
        storage_limit_mb=45000,
        wazuh_mode="full",
        keycloak_mode="docker",
    ),
    "oci_12gib": Profile(
        name="oci_12gib",
        max_pods=1,
        pod_ram_mb=4096,
        ram_buffer_mb=1536,
        pod_storage_mb=7168,
        storage_limit_mb=180000,
        wazuh_mode="manager_only",
        keycloak_mode="native",
    ),
}


def get_profile(name: str) -> Profile:
    """Retrieve a profile by name.

    Raises:
        UnknownProfileError: if the profile name is not registered.
    """
    if name not in PROFILES:
        raise UnknownProfileError(f"Unknown profile: {name}")
    return PROFILES[name]


def active_profile() -> Profile:
    """Get the active deployment profile.

    Reads the PROFILE environment variable; defaults to 'onprem' if unset.
    """
    profile_name = os.getenv("PROFILE", "onprem")
    return get_profile(profile_name)
