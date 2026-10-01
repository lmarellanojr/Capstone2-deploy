import type { InstructorMilestone } from "@/lib/api"

/**
 * Picks the automated verifier attempts that relate to a review case.
 *
 * Source: INSTRUCTOR_API_HANDOFF.md §2.4 "Automated Verifier Evidence" —
 * correlated read-only from GET /instructor/students/{student_id}, never
 * written back to milestone_verification.
 *
 * Matches on scenario_id; when the case targets a specific milestone, also
 * matches milestone_id. A null milestone_id (overall report) keeps every
 * milestone of the scenario. Newest attempt first.
 */
export function selectVerifierAttempts(
  milestones: InstructorMilestone[],
  scenarioId: number,
  milestoneId: number | null
): InstructorMilestone[] {
  return milestones
    .filter(
      (m) =>
        Number(m.scenario_id) === Number(scenarioId) &&
        (milestoneId === null || Number(m.milestone_id) === Number(milestoneId))
    )
    .sort((a, b) => (b.verified_at ?? "").localeCompare(a.verified_at ?? ""))
}

/** One row of the evidence table: a run of identical consecutive attempts. */
export interface VerifierAttemptGroup {
  milestone_id: number
  status: string
  pod_id?: number
  detection_score?: number
  detection_data?: string | null
  count: number
  /** Newest attempt in the run (input is newest first). */
  latest?: string
  /** Oldest attempt in the run. */
  earliest?: string
}

/**
 * Collapses back-to-back attempts with the same milestone, result, lab and
 * corroboration into one row. The score poller re-checks every few seconds,
 * so an unfinished milestone otherwise fills the table with identical FAILs
 * and hides the attempts that actually differ. Expects newest-first input.
 */
export function groupVerifierAttempts(attempts: InstructorMilestone[]): VerifierAttemptGroup[] {
  const groups: VerifierAttemptGroup[] = []
  for (const m of attempts) {
    const prev = groups[groups.length - 1]
    if (
      prev &&
      prev.milestone_id === Number(m.milestone_id) &&
      prev.status === m.status &&
      prev.pod_id === m.pod_id &&
      (prev.detection_data ?? null) === (m.detection_data ?? null) &&
      (prev.detection_score ?? 0) === (m.detection_score ?? 0)
    ) {
      prev.count += 1
      prev.earliest = m.verified_at
      continue
    }
    groups.push({
      milestone_id: Number(m.milestone_id),
      status: m.status,
      pod_id: m.pod_id,
      detection_score: m.detection_score,
      detection_data: m.detection_data,
      count: 1,
      latest: m.verified_at,
      earliest: m.verified_at,
    })
  }
  return groups
}

/** Plain-English reading of milestone_verification.detection_data. */
export function describeCorroboration(data: string | null | undefined, detectionScore?: number): string {
  const value = data?.trim()
  if (!value) return detectionScore ? "Wazuh detection recorded" : "No corroborating evidence"
  const rule = value.match(/^rule (\S+) on agent (\S+)$/)
  if (rule) return `Wazuh rule ${rule[1]} fired on agent ${rule[2]}`
  if (value.startsWith("browser:")) return `Browser action detected (${value.slice("browser:".length)})`
  if (value === "corroborated_hybrid_flag_state") return "Submitted flag matched the lab's state"
  if (value === "instructor_approved_conflict") return "Approved by an instructor (scoring conflict)"
  if (value.startsWith("siem-check-error:")) return `SIEM check failed: ${value.slice("siem-check-error:".length).trim()}`
  return value
}

export interface VerifierSummary {
  total: number
  passed: boolean
  /** Oldest PASS, i.e. when the milestone was first achieved. */
  firstPassAt?: string
  latestStatus?: string
  latestAt?: string
}

/** Headline facts for a set of newest-first attempts. */
export function summarizeVerifierAttempts(attempts: InstructorMilestone[]): VerifierSummary {
  const passes = attempts.filter((m) => m.status === "PASS")
  return {
    total: attempts.length,
    passed: passes.length > 0,
    firstPassAt: passes.length ? passes[passes.length - 1].verified_at : undefined,
    latestStatus: attempts[0]?.status,
    latestAt: attempts[0]?.verified_at,
  }
}
