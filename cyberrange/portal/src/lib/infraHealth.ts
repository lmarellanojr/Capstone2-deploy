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

export function unavailableServicesFromError(message: string): InfraService[] {
  return [
    { name: "API", status: "Unavailable", detail: message },
    { name: "LXD", status: "Unavailable", detail: message },
  ]
}
