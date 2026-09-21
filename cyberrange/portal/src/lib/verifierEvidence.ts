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
