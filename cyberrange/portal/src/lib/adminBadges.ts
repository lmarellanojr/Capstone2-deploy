// ADM-POD-UI handoff §4.3: the five statuses the backend actually sets.
export function adminPodBadgeVariant(status: string): "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "PROVISIONING" || status === "DESTROYING") return "warning";
  if (status === "FAILED_ROLLBACK_COMPLETE") return "danger";
  return "info"; // DESTROYED
}

// Force-destroy CAS (handoff doc §2, §6): 200 only for ACTIVE / FAILED_ROLLBACK_COMPLETE,
// 409 for PROVISIONING / DESTROYING / DESTROYED.
export function canForceDestroy(status: string): boolean {
  return status === "ACTIVE" || status === "FAILED_ROLLBACK_COMPLETE";
}
