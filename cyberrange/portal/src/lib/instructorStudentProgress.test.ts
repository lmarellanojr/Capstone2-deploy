import {
  isBackgroundNonPass,
  overallPassedAttempted,
  scenarioProgressDetails,
  totalPointsEarned,
  touchedScenarioSummaries,
  verificationSourceLabel,
} from "./instructorStudentProgress"
import type { InstructorMilestone } from "@/lib/api"

const S = [
  {
    id: "01",
    displayNumber: 1,
    name: "Recon",
    milestones: [
      { id: 1, name: "Hosts", points: 50 },
      { id: 2, name: "Ports", points: 50 },
    ],
  },
  {
    id: "06",
    displayNumber: 2,
    name: "SQLi",
    milestones: [
      { id: 1, name: "Union", points: 50 },
      { id: 4, name: "XSS", points: 75 },
    ],
  },
]

const rows: InstructorMilestone[] = [
  { scenario_id: 1, milestone_id: 1, status: "PASS", detection_score: 0, verified_at: "2026-10-15 01:00:00" },
  { scenario_id: 1, milestone_id: 1, status: "FAIL", detection_score: 0, verified_at: "2026-10-15 00:50:00" },
  { scenario_id: 1, milestone_id: 2, status: "FAIL", detection_score: 0, verified_at: "2026-10-15 01:10:00" },
  { scenario_id: 6, milestone_id: 4, status: "PASS", detection_score: 0, verified_at: "2026-10-15 02:00:00" },
]

describe("isBackgroundNonPass", () => {
  it("hides auto rows with any non-PASS status", () => {
    expect(isBackgroundNonPass({ source: "auto", status: "FAIL" })).toBe(true)
    expect(isBackgroundNonPass({ source: "auto", status: "ERROR" })).toBe(true)
    expect(isBackgroundNonPass({ source: "auto", status: "UNKNOWN" })).toBe(true)
    expect(isBackgroundNonPass({ source: "auto", status: "PASS" })).toBe(false)
    expect(isBackgroundNonPass({ source: "manual", status: "FAIL" })).toBe(false)
    expect(isBackgroundNonPass({ source: "manual", status: "ERROR" })).toBe(false)
    expect(isBackgroundNonPass({ source: null, status: "FAIL" })).toBe(false)
    expect(isBackgroundNonPass({ status: "FAIL" })).toBe(false)
    expect(isBackgroundNonPass({ source: "AUTO", status: "FAIL" })).toBe(false)
  })

  it("labels sources for the Source column", () => {
    expect(verificationSourceLabel("auto")).toBe("auto")
    expect(verificationSourceLabel(null)).toBe("—")
    expect(verificationSourceLabel(undefined)).toBe("—")
  })
})

describe("instructorStudentProgress", () => {
  it("counts distinct passed / attempted for catalog milestones only", () => {
    expect(overallPassedAttempted(rows, S)).toEqual({ passed: 2, attempted: 3 })
    const withLegacy = [
      ...rows,
      { scenario_id: 99, milestone_id: 1, status: "PASS", detection_score: 0, verified_at: "2026-10-15 03:00:00" },
    ]
    expect(overallPassedAttempted(withLegacy, S)).toEqual({ passed: 2, attempted: 3 })
  })

  it("sums catalog points the same way the student dashboard does", () => {
    expect(totalPointsEarned(rows, S)).toBe(125)
  })

  it("builds per-scenario chips only for touched labs", () => {
    const chips = touchedScenarioSummaries(rows, S)
    expect(chips.map((c) => c.label)).toEqual(["Scenario 1", "Scenario 2"])
    expect(chips[0]).toMatchObject({ passed: 1, total: 2, pointsEarned: 50, pointsTotal: 100 })
    expect(chips[1]).toMatchObject({ passed: 1, total: 2, pointsEarned: 75, pointsTotal: 125 })
  })

  it("expands milestone names with effective PASS/FAIL", () => {
    const detail = scenarioProgressDetails(rows, S).find((s) => s.scenarioId === "01")!
    expect(detail.milestones).toEqual([
      { milestoneId: 1, name: "Hosts", points: 50, status: "PASS", detectionScore: 0 },
      { milestoneId: 2, name: "Ports", points: 50, status: "FAIL", detectionScore: 0 },
    ])
  })
})
