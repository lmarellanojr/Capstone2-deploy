export type InfraStatus = "Healthy" | "Degraded" | "Unavailable"

export type InfraService = {
  name: string
  status: InfraStatus
  detail: string
}

export type InfraHealth = {
  capacity: {
    available_mb: number | null
    active_pods: number
    max_pods: number
    pod_ram_mb: number
    ram_buffer_mb: number
    ram_required_mb: number
    profile: string
    can_provision: boolean
  } | null
  services: InfraService[]
}

export function badgeVariantForStatus(
  status: InfraStatus
): "success" | "warning" | "danger" {
  if (status === "Healthy") return "success"
  if (status === "Degraded") return "warning"
  return "danger"
}

// verify_token's 503 body when the API could not introspect the caller's token
// (Keycloak down, timed out, or rejecting the API client). The API itself answered.
export const AUTH_SERVICE_UNAVAILABLE = "Auth service unavailable"

const NOT_CHECKED = "not checked (API unreachable)"

/**
 * Fail closed without fabricating a Healthy row.
 * - 401/403: empty list (banner only — nothing was checked)
 * - 503 "Auth service unavailable": the API answered but could not reach
 *   Keycloak to verify the session, so Keycloak is the service that is down
 * - other failures: API gets the error; LXD, Keycloak and Wazuh say they
 *   were not checked (the backend probes them, so they were never reached)
 */
export function servicesFromFetchFailure(
  message: string,
  httpStatus?: number | null,
  apiDetail?: unknown
): InfraService[] {
  if (httpStatus === 401 || httpStatus === 403) {
    return []
  }
  if (httpStatus === 503 && apiDetail === AUTH_SERVICE_UNAVAILABLE) {
    const notChecked = "not checked (session could not be verified)"
    return [
      { name: "API", status: "Degraded", detail: "responding, but cannot verify sessions with Keycloak" },
      { name: "LXD", status: "Unavailable", detail: notChecked },
      { name: "Keycloak", status: "Unavailable", detail: "API could not reach Keycloak to verify your session" },
      { name: "Wazuh", status: "Unavailable", detail: notChecked },
    ]
  }
  return [
    { name: "API", status: "Unavailable", detail: message },
    ...["LXD", "Keycloak", "Wazuh"].map((name) => ({
      name,
      status: "Unavailable" as const,
      detail: NOT_CHECKED,
    })),
  ]
}

export function formatCheckedAt(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}
