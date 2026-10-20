// Presentation helpers for audit_log rows (GET /admin/audit-log).
// Admin writers put the acting Admin first in `detail` as "actor=<username>",
// then space-separated key=value facts (users_router._audit,
// pods_router._audit_force_destroy). Other writers use comma-separated facts
// or free text (provision.py, hybrid_scoring.py, pods_router review routes).

export type AuditCategory = "admin" | "lab" | "scoring"

interface EventInfo {
  label: string
  description: string
  category: AuditCategory
}

const EVENTS: Record<string, EventInfo> = {
  // Admin actions
  ADMIN_USER_CREATE: { label: "User created", description: "An admin created a portal account.", category: "admin" },
  ADMIN_USER_ENABLE: { label: "User enabled", description: "An admin re-enabled a portal account.", category: "admin" },
  ADMIN_USER_DISABLE: { label: "User disabled", description: "An admin disabled a portal account; the user can no longer sign in.", category: "admin" },
  ADMIN_USER_ROLE_SET: { label: "Role changed", description: "An admin changed a user's role.", category: "admin" },
  ADMIN_USER_PASSWORD_RESET: { label: "Password reset", description: "An admin set a new password and signed the user out everywhere.", category: "admin" },
  ADMIN_USER_MFA_RESET: { label: "Authenticator reset", description: "An admin removed the user's authenticator app (MFA), so they set it up again at next sign-in.", category: "admin" },
  ADMIN_POD_FORCE_DESTROY: { label: "Lab force-destroyed", description: "An admin removed a student's lab machines.", category: "admin" },

  // Lab start-up and clean-up (provision.py, wazuh_client.py, reaper.py)
  PROVISION_SUCCESS: { label: "Lab started", description: "Every lab machine was set up and the lab is ready.", category: "lab" },
  PROVISION_FAILED: { label: "Lab failed to start", description: "Lab set-up stopped with an error and was rolled back.", category: "lab" },
  NET_CREATE_OK: { label: "Lab network created", description: "The student's private lab network was created.", category: "lab" },
  NET_APPLY_OK: { label: "Lab network configured", description: "Networking and access keys were applied to the lab machines.", category: "lab" },
  CLONE_OK: { label: "Lab machine created", description: "One lab machine was copied from its template.", category: "lab" },
  GUEST_NIC_UP_OK: { label: "Lab machine online", description: "A lab machine connected to the lab network.", category: "lab" },
  GUEST_NIC_UP_FAIL: { label: "Lab machine offline", description: "A lab machine did not connect to the lab network in time.", category: "lab" },
  DVWA_COMPOSE_OK: { label: "Lab web app installed", description: "The vulnerable web app (DVWA) was started inside the lab.", category: "lab" },
  DVWA_COMPOSE_FAIL: { label: "Lab web app failed to install", description: "The vulnerable web app (DVWA) could not be started.", category: "lab" },
  DVWA_READY_OK: { label: "Lab web app ready", description: "The vulnerable web app (DVWA) is answering requests.", category: "lab" },
  DVWA_READY_FAIL: { label: "Lab web app didn't start", description: "The vulnerable web app (DVWA) never became ready.", category: "lab" },
  LAB_PROXY_OK: { label: "Browser access ready", description: "The student can open the lab web app from their browser.", category: "lab" },
  LAB_PROXY_FAIL: { label: "Browser access failed", description: "Browser access to the lab web app could not be set up.", category: "lab" },
  FLAGS_PLANTED_OK: { label: "Flags placed", description: "The student's personal flags were placed in the lab.", category: "lab" },
  FLAGS_PLANTED_FAIL: { label: "Flags not placed", description: "The student's flags could not be placed in the lab.", category: "lab" },
  WAZUH_ENROLL_OK: { label: "SIEM monitoring connected", description: "The lab machines report to the Wazuh SIEM.", category: "lab" },
  WAZUH_ENROLL_FAIL: { label: "SIEM monitoring failed", description: "The lab machines could not be connected to the Wazuh SIEM.", category: "lab" },
  WAZUH_STALE_AGENT: { label: "Lab blocked by old SIEM agent", description: "A Wazuh agent from an earlier lab is still registered, so the lab was refused. Remove the old agent, then retry.", category: "lab" },
  WAZUH_CLEANUP_SKIPPED: { label: "SIEM clean-up skipped", description: "Old Wazuh agents were not removed because the provisioner user is not set up on this host. A student's next lab may be refused until an operator removes them.", category: "lab" },
  POD_TTL_REAP: { label: "Lab expired", description: "The lab reached its time limit and was removed automatically.", category: "lab" },
  POD_STUCK_PROVISIONING_REAP: { label: "Stuck lab start cleaned up", description: "A lab stuck while starting was cleaned up automatically.", category: "lab" },
  POD_STUCK_DESTROYING_REAP: { label: "Stuck lab removal retried", description: "A lab stuck while being removed was removed again automatically.", category: "lab" },

  // Scoring and reviews (scoring.py, hybrid_scoring.py, pods_router.py)
  MILESTONE_VERIFIED: { label: "Task checked", description: "The student ran the automatic check for a task.", category: "scoring" },
  MILESTONE_VERIFY_FAILED: { label: "Task check errored", description: "The automatic task check could not run.", category: "scoring" },
  HYBRID_SCORE_PASS: { label: "Flag accepted", description: "The student submitted a correct flag and the task was completed.", category: "scoring" },
  HYBRID_SCORE_ESCALATED: { label: "Sent to instructor review", description: "The flag and the lab state disagreed, so an instructor must review it. The student only saw \"incomplete\".", category: "scoring" },
  HYBRID_SCORE_INCOMPLETE: { label: "Flag not accepted", description: "Neither the flag nor the lab state met the task.", category: "scoring" },
  REVIEW_CASE_RESOLVED: { label: "Review graded", description: "An instructor (or auto-grading) decided a review case.", category: "scoring" },
  REVIEW_CASE_RESUBMITTED: { label: "Review resubmitted", description: "The student resubmitted a rejected review.", category: "scoring" },
  SCENARIO_PROGRESS_RESET: { label: "Progress reset (Try Again)", description: "The student cleared their own progress on a scenario.", category: "scoring" },
  KNOWLEDGE_GAIN_EXPORTED: { label: "Scoring data exported", description: "An instructor or admin downloaded knowledge-gain scoring data. The details say whether student IDs were anonymized; a refused identified export shows as Denied.", category: "scoring" },
}

export const AUDIT_CATEGORIES: { id: AuditCategory | "all"; label: string }[] = [
  { id: "admin", label: "Admin actions" },
  { id: "lab", label: "Lab activity" },
  { id: "scoring", label: "Scoring & reviews" },
  { id: "all", label: "All" },
]

/** Event types in one category. Unknown (newer) types only appear under All. */
export function auditCategoryTypes(category: AuditCategory): string[] {
  return Object.keys(EVENTS).filter((t) => EVENTS[t].category === category)
}

export function auditEventCategory(eventType: string): AuditCategory | null {
  return EVENTS[eventType]?.category ?? null
}

/** Friendly name for a known event type; unknown types are shown as-is. */
export function auditEventLabel(eventType: string): string {
  return EVENTS[eventType]?.label ?? eventType
}

export function auditEventDescription(eventType: string): string | null {
  return EVENTS[eventType]?.description ?? null
}

const RESULT_LABELS: Record<string, string> = {
  OK: "OK",
  FAILED: "Failed",
  FAIL: "Failed",
  ERROR: "Error",
  DENIED: "Denied",
  PASS: "Passed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ESCALATED: "Needs review",
  PENDING: "Pending",
  INCOMPLETE: "Incomplete",
  RETRY: "Try again",
  UNKNOWN: "Unknown",
}

/** The row's result, or the outcome carried in the event name when the
 *  writer left result empty (PROVISION_FAILED, DVWA_READY_OK, ...). The OK /
 *  Failed filters (audit_router._RESULT_GROUPS / _NAME_SUFFIXES) return every
 *  operation outcome badged OK, Passed, Failed or Error; change both together.
 *  Review decisions (Approved, Rejected, Try again) share the colours but not
 *  the labels, and are not in those filters. */
export function auditResult(event: { event_type: string; result: string | null }): string | null {
  if (event.result) return event.result.toUpperCase()
  if (/_(OK|SUCCESS)$/.test(event.event_type)) return "OK"
  if (/_(FAIL|FAILED)$/.test(event.event_type)) return "FAILED"
  return null
}

export function auditResultLabel(result: string): string {
  return RESULT_LABELS[result.toUpperCase()] ?? result
}

export function auditResultVariant(result: string | null): "success" | "danger" | "warning" | "default" {
  switch ((result ?? "").toUpperCase()) {
    case "OK":
    case "PASS":
    case "APPROVED":
      return "success"
    case "FAILED":
    case "FAIL":
    case "ERROR":
    case "REJECTED":
      return "danger"
    case "DENIED":
    case "ESCALATED":
    case "INCOMPLETE":
    case "PENDING":
    case "RETRY":
      return "warning"
    default:
      return "default"
  }
}

// Events the target user triggers on their own account (resubmitting a
// review, "Try Again", checking a task, submitting a flag), so student_id is
// also the actor.
const SELF_EVENTS = new Set([
  "REVIEW_CASE_RESUBMITTED",
  "SCENARIO_PROGRESS_RESET",
  "MILESTONE_VERIFIED",
  "MILESTONE_VERIFY_FAILED",
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

const KEY_LABELS: Record<string, string> = {
  role: "Role",
  previous: "Previous role",
  previous_status: "Status before",
  status: "Status",
  temporary: "Temporary password",
  temporary_password: "Temporary password",
  removed: "Authenticators removed",
  sessions: "Sessions ended",
  review_id: "Review",
  score: "Score",
  scenario: "Scenario",
  scenario_id: "Scenario",
  milestones: "Tasks",
  manager: "SIEM manager",
  agents: "SIEM agents",
  port: "Port",
  source: "Step",
}

// users_router / pods_router reason= codes.
const REASONS: Record<string, string> = {
  self: "admins can't change their own account here",
  actor_not_admin: "the caller isn't an admin",
  last_admin: "it would leave no admin",
  exists: "the username already exists",
  rejected: "Keycloak rejected the details",
  keycloak: "Keycloak error",
  keycloak_after_set: "Keycloak error after the password was set",
  keycloak_after_remove: "Keycloak error after the authenticator was removed",
  keycloak_partial_remove: "only some authenticators were removed",
  password_policy: "the password doesn't meet the policy",
  not_found: "the lab no longer exists",
  state: "the lab wasn't in a state that can be destroyed",
  provisioner_not_configured: "the Wazuh provisioner user isn't set up on this host",
}

// WAZUH_CLEANUP_SKIPPED source= values (wazuh_client._audit_cleanup_skipped).
const SOURCES: Record<string, string> = {
  teardown: "lab teardown",
  remove_by_name: "lab start (old agent names)",
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

function formatValue(key: string, value: string): string {
  if (value === "True") return "Yes"
  if (value === "False") return "No"
  if (key === "review_id") return `#${value}`
  if (key === "source") return SOURCES[value] ?? value.replace(/_/g, " ")
  if (["role", "previous", "status", "previous_status"].includes(key)) return titleCase(value)
  return value
}

/** Splits on commas, and on whitespace that starts a new key=value fact,
 *  but never inside brackets ("milestones=[1, 2, 3]", "(review_id=7)"). */
function splitFacts(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if ("[({".includes(c)) depth++
    else if ("])}".includes(c)) depth = Math.max(0, depth - 1)
    const startsFact = /\s/.test(c) && /^\s*[a-z_]+=/.test(text.slice(i))
    if (depth === 0 && (c === "," || startsFact)) {
      parts.push(current)
      current = ""
      continue
    }
    current += c
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Turns detail facts into a sentence an admin can read, e.g.
 *  "role=instructor previous=student" -> "Role: Student → Instructor".
 *  Free text (error messages, scoring notes) is left unchanged. */
export function humanizeAuditFacts(facts: string): string {
  if (!facts) return ""
  const text = facts.replace(/\brolled_back\b/g, "rollback=done").replace(/\brollback_failed\b/g, "rollback=failed")
  const parts = splitFacts(text)
  const pairs = new Map<string, string>()
  for (const p of parts) {
    const m = p.match(/^([a-z_]+)=(.*)$/)
    if (m) pairs.set(m[1], m[2])
  }
  if (pairs.size === 0) return facts

  const out: string[] = []
  for (const p of parts) {
    const m = p.match(/^([a-z_]+)=(.*)$/)
    if (!m) {
      out.push(p)
      continue
    }
    const [, key, value] = m
    if (key === "previous" && pairs.has("role")) continue // folded into Role
    if (key === "role" && pairs.has("previous")) {
      out.push(`Role: ${formatValue(key, pairs.get("previous") as string)} → ${formatValue(key, value)}`)
    } else if (key === "reason") {
      out.push(`Reason: ${REASONS[value] ?? value.replace(/_/g, " ")}`)
    } else if (key === "rollback") {
      out.push(value === "done" ? "New account was rolled back" : "Rolling back the new account failed")
    } else {
      out.push(`${KEY_LABELS[key] ?? titleCase(key.replace(/_/g, " "))}: ${formatValue(key, value)}`)
    }
  }
  return out.join(" · ")
}
