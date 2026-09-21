# ADM-SYS-01 Infra health contract

**Issue:** [#37](https://github.com/lmarellanojr/Capstone2-deploy/issues/37)  
**Audience:** Maricar Punzalan (Admin display), Lenie Joice Mendoza (ADM-SYS-02 #55)  
**Author:** Leonardo Arellano

## What exists

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/capacity` | none | Unchanged public RAM/pod budget. Keys: `available_mb` (`int\|null`), `active_pods`, `max_pods`, `pod_ram_mb`, `ram_buffer_mb`, `profile`, `ram_required_mb`, `can_provision` (snapshot). |
| GET | `/health` | none | Process liveness `{"status":"ok"}`. Not an Admin document. Does not probe LXD. |
| GET | `/admin/infra-health` | Admin | Capacity snapshot + `services[]` for **API** and **LXD** only. |

Portal: `GET /api/capacity` (already), `GET /api/admin/infra-health` (this issue). Handoff §3 still says there is no `/api/capacity` proxy — that table is stale; do not skip the existing proxy.

## `GET /admin/infra-health` 200 body

`status` is exactly `Healthy` | `Degraded` | `Unavailable`.

```json
{
  "capacity": {
    "available_mb": 8192,
    "active_pods": 0,
    "max_pods": 1,
    "pod_ram_mb": 4096,
    "ram_buffer_mb": 1536,
    "profile": "oci_12gib",
    "ram_required_mb": 5632,
    "can_provision": true
  },
  "services": [
    { "name": "API", "status": "Healthy", "detail": "provisioning API responding" },
    { "name": "LXD", "status": "Healthy", "detail": "20480 MiB free" }
  ]
}
```

`capacity` is `null` if the pods COUNT fails. Do not add Keycloak or Wazuh rows.

HTTP 200 with an Unavailable row is success for the UI. Proxy/network failure is portal 503 — show API Unavailable, do not keep a previous Healthy badge.

## Do not

- Do not treat `can_provision: true` as a guarantee (P0-01).
- Do not show mock `podsInUse` / `storageUsedGb`.
- Do not label the LXD row `LXD / OVN` (OVN is not probed).
- Do not add Keycloak or Wazuh rows here.

## #55 extension

Append further `{name, status, detail}` objects to `services` using the same three status strings. Bounded timeouts; fail closed to Unavailable. Do not change `/capacity` or `/health`.
