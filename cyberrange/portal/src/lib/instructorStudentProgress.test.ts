import {
  overallPassedAttempted,
  scenarioProgressDetails,
  totalPointsEarned,
  touchedScenarioSummaries,
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

describe("instructorStudentProgress", () => {
  it("counts distinct passed / attempted like the old roster column", () => {
    expect(overallPassedAttempted(rows)).toEqual({ passed: 2, attempted: 3 })
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
