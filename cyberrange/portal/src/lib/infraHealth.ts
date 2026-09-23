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

/**
 * Fail closed without fabricating a Healthy row.
 * - 401/403: empty list (banner only — LXD was never checked)
 * - other failures: API gets the error; LXD says it was not checked
 */
export function servicesFromFetchFailure(
  message: string,
  httpStatus?: number | null
): InfraService[] {
  if (httpStatus === 401 || httpStatus === 403) {
    return []
  }
  return [
    { name: "API", status: "Unavailable", detail: message },
    { name: "LXD", status: "Unavailable", detail: "not checked (API unreachable)" },
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
