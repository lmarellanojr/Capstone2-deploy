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

import {
  describeCorroboration,
  groupVerifierAttempts,
  summarizeVerifierAttempts,
} from "./verifierEvidence"

function attempt(status: string, verified_at: string, extra: Record<string, unknown> = {}) {
  return { scenario_id: 6, milestone_id: 2, status, verified_at, pod_id: 3, detection_data: null, ...extra }
}

describe("groupVerifierAttempts", () => {
  it("merges back-to-back identical attempts and keeps the time range", () => {
    const groups = groupVerifierAttempts([
      attempt("FAIL", "2026-09-30 02:31:09"),
      attempt("FAIL", "2026-09-30 02:31:06"),
      attempt("FAIL", "2026-09-30 02:31:03"),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ count: 3, latest: "2026-09-30 02:31:09", earliest: "2026-09-30 02:31:03" })
  })

  it("starts a new row when result, lab or corroboration changes", () => {
    const groups = groupVerifierAttempts([
      attempt("PASS", "2026-09-30 02:32:00", { detection_data: "browser:sqli-m2" }),
      attempt("FAIL", "2026-09-30 02:31:09"),
      attempt("FAIL", "2026-09-30 02:31:06", { pod_id: 2 }),
    ])
    expect(groups.map((g) => [g.status, g.pod_id, g.count])).toEqual([
      ["PASS", 3, 1],
      ["FAIL", 3, 1],
      ["FAIL", 2, 1],
    ])
  })
})

describe("describeCorroboration", () => {
  it.each([
    ["rule 5710 on agent 012", 1, "Wazuh rule 5710 fired on agent 012"],
    ["browser:sqli-m1", 0, "Browser action detected (sqli-m1)"],
    ["corroborated_hybrid_flag_state", 0, "Submitted flag matched the lab's state"],
    ["instructor_approved_conflict", 0, "Approved by an instructor (scoring conflict)"],
    ["siem-check-error: timeout", 0, "SIEM check failed: timeout"],
    [null, 0, "No corroborating evidence"],
    [null, 1, "Wazuh detection recorded"],
    ["something new", 0, "something new"],
  ])("%p -> %p", (data, score, expected) => {
    expect(describeCorroboration(data as string | null, score as number)).toBe(expected)
  })
})

describe("summarizeVerifierAttempts", () => {
  it("reports the first PASS and the latest result", () => {
    const s = summarizeVerifierAttempts([
      attempt("PASS", "2026-09-30 02:40:00"),
      attempt("PASS", "2026-09-30 02:35:00"),
      attempt("FAIL", "2026-09-30 02:31:00"),
    ])
    expect(s).toEqual({
      total: 3,
      passed: true,
      firstPassAt: "2026-09-30 02:35:00",
      latestStatus: "PASS",
      latestAt: "2026-09-30 02:40:00",
    })
  })

  it("says never passed", () => {
    expect(summarizeVerifierAttempts([attempt("FAIL", "2026-09-30 02:31:00")]).passed).toBe(false)
  })
})
