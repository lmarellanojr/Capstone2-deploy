import { alertCsvRows, buildStudentProgressCsv, milestoneCsvRows, reviewCsvRows } from "./studentProgressCsv"
import type { InstructorMilestone, ReviewCase, SiemAlert } from "@/lib/api"

const milestones: InstructorMilestone[] = [
  { scenario_id: 6, milestone_id: 4, status: "PASS", detection_score: 0, verified_at: "2026-10-15 01:00:00" },
  { scenario_id: 9, milestone_id: 1, status: "FAIL", detection_score: 1, detection_data: "rule 5710" },
]

const reviews: ReviewCase[] = [
  {
    review_id: 3,
    student_id: "srivera",
    scenario_id: 9,
    milestone_id: 1,
    case_type: "WRITTEN_REPORT",
    report_text: "timeline",
    conflict_reason: null,
    evidence_data: null,
    score: 80,
    status: "APPROVED",
    feedback: "ok",
    graded_by: "leo",
    created_at: "2026-10-15 02:00:00",
    updated_at: "2026-10-15 02:05:00",
  },
]

const alerts: SiemAlert[] = [
  {
    timestamp: "2026-10-15T02:00:00.000+0000",
    agent_id: "012",
    agent_name: "pod-srivera-meta",
    rule_id: "5710",
    rule_description: "sshd: attempt to login using a non-existent user",
    rule_level: 5,
  },
]

describe("studentProgressCsv", () => {
  it("includes milestone status, numeric score, and SIEM label", () => {
    const rows = milestoneCsvRows(milestones)
    expect(rows[0]).toEqual([
      "Scenario 2",
      6,
      4,
      "PASS",
      0,
      "Not configured",
      "",
      "",
      "2026-10-15 01:00:00",
    ])
    expect(rows[1][5]).toBe("Detected")
  })

  it("includes review scores", () => {
    expect(reviewCsvRows(reviews)[0][5]).toBe(80)
  })

  it("builds a multi-section CSV with optional alerts", () => {
    const csv = buildStudentProgressCsv({
      studentId: "srivera",
      milestones,
      reviews,
      alerts,
      alertsLabel: "live",
    })
    expect(csv).toContain("# student_id,srivera")
    expect(csv).toContain("# section,milestones")
    expect(csv).toContain("Not configured")
    expect(csv).toContain("# section,reviews")
    expect(csv).toContain("# section,alerts (live)")
    expect(alertCsvRows(alerts)[0][1]).toBe("5710")
  })
})
