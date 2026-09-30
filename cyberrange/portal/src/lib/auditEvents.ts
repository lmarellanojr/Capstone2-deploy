// Presentation helpers for audit_log rows (GET /admin/audit-log).
// Writers put the acting Admin first in `detail` as "actor=<username>", then
// space-separated key=value facts (users_router._audit,
// pods_router._audit_force_destroy).

const LABELS: Record<string, string> = {
  ADMIN_USER_CREATE: "User created",
  ADMIN_USER_ENABLE: "User enabled",
  ADMIN_USER_DISABLE: "User disabled",
  ADMIN_USER_ROLE_SET: "Role changed",
  ADMIN_USER_PASSWORD_RESET: "Password reset",
  ADMIN_POD_FORCE_DESTROY: "Pod force-destroyed",
  REVIEW_CASE_RESUBMITTED: "Review resubmitted",
}

/** Friendly name for a known event type; unknown types are shown as-is. */
export function auditEventLabel(eventType: string): string {
  return LABELS[eventType] ?? eventType
}

export function auditResultVariant(result: string | null): "success" | "danger" | "warning" | "default" {
  switch ((result ?? "").toUpperCase()) {
    case "OK":
      return "success"
    case "FAILED":
      return "danger"
    case "DENIED":
      return "warning"
    default:
      return "default"
  }
}

/** Splits "actor=admin_demo role=student previous=none" into the actor and
 *  the remaining facts. Values never contain spaces in these writers. */
export function parseAuditDetail(detail: string | null): { actor: string | null; facts: string } {
  if (!detail) return { actor: null, facts: "" }
  const parts = detail.trim().split(/\s+/)
  const actorPart = parts.find((p) => p.startsWith("actor="))
  return {
    actor: actorPart ? actorPart.slice("actor=".length) || null : null,
    facts: parts.filter((p) => p !== actorPart).join(" "),
  }
}
