import { selectVerifierAttempts } from "./verifierEvidence"
import type { InstructorMilestone } from "./api"

const attempts: InstructorMilestone[] = [
  { scenario_id: 6, milestone_id: 1, status: "FAIL", detection_score: 0, verified_at: "2026-09-20 10:00:00" },
  { scenario_id: 6, milestone_id: 1, status: "PASS", detection_score: 80, verified_at: "2026-09-20 11:00:00" },
  { scenario_id: 6, milestone_id: 2, status: "PASS", detection_score: 50, verified_at: "2026-09-20 12:00:00" },
  { scenario_id: 1, milestone_id: 1, status: "PASS", detection_score: 100, verified_at: "2026-09-19 09:00:00" },
]

describe("selectVerifierAttempts", () => {
  it("keeps only the case's scenario and milestone, newest first", () => {
    const result = selectVerifierAttempts(attempts, 6, 1)
    expect(result.map((m) => m.status)).toEqual(["PASS", "FAIL"])
  })

  it("keeps every milestone of the scenario for an overall report", () => {
    const result = selectVerifierAttempts(attempts, 6, null)
    expect(result.map((m) => m.milestone_id)).toEqual([2, 1, 1])
  })

  it("treats Scenario 2 as internal scenario 06 without remapping", () => {
    expect(selectVerifierAttempts(attempts, 2, null)).toEqual([])
  })

  it("returns an empty list when nothing matches", () => {
    expect(selectVerifierAttempts(attempts, 9, 1)).toEqual([])
  })

  it("does not mutate the input array", () => {
    const copy = [...attempts]
    selectVerifierAttempts(attempts, 6, null)
    expect(attempts).toEqual(copy)
  })
})
