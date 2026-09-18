export function podBadgeVariant(status: string): "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "PROVISIONING" || status === "DESTROYING") return "warning";
  return "info";
}
