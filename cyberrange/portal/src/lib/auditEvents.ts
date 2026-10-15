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

// Events the target user triggers on their own account (resubmitting a
// review, "Try Again", submitting a flag), so student_id is also the actor.
const SELF_EVENTS = new Set([
  "REVIEW_CASE_RESUBMITTED",
  "SCENARIO_PROGRESS_RESET",
  "HYBRID_SCORE_PASS",
  "HYBRID_SCORE_ESCALATED",
  "HYBRID_SCORE_INCOMPLETE",
])

// hybrid_scoring writes graded_by=SYSTEM_HYBRID when it auto-approves a review.
const SYSTEM_GRADER = "SYSTEM_HYBRID"

export interface AuditActor {
  /** Who did it: a username, or "System" for automatic events. */
  actor: string
  system: boolean
  /** detail with the actor fact removed. */
  facts: string
}

/** Who performed an audit event. Most writers carry no actor= fact: review
 *  grading records graded_by=, self-service events only have student_id, and
 *  provisioning / reaper events are automatic. */
export function auditActor(event: {
  event_type: string
  student_id: string | null
  detail: string | null
}): AuditActor {
  const { actor, facts } = parseAuditDetail(event.detail)
  if (actor) return { actor, system: false, facts }

  const grader = facts.match(/(?:^|[\s,])graded_by=([^\s,]+)/)
  if (grader) {
    const rest = facts.replace(/,?\s*graded_by=[^\s,]+,?/, "").trim()
    return grader[1] === SYSTEM_GRADER
      ? { actor: "System (auto-grade)", system: true, facts: rest }
      : { actor: grader[1], system: false, facts: rest }
  }

  if (SELF_EVENTS.has(event.event_type) && event.student_id) {
    return { actor: event.student_id, system: false, facts }
  }
  return { actor: "System", system: true, facts }
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
