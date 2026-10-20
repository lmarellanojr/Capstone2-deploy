/** @jest-environment jsdom */
import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { MilestoneScoreStrip } from "./MilestoneScoreStrip"
import type { InstructorMilestone } from "@/lib/api"
import { isBackgroundAutoFail } from "@/lib/instructorStudentProgress"

function row(
  partial: Partial<InstructorMilestone> & Pick<InstructorMilestone, "status">,
): InstructorMilestone {
  return {
    scenario_id: 1,
    milestone_id: 1,
    detection_score: 0,
    verified_at: "2026-10-20 12:00:00",
    ...partial,
  }
}

describe("MilestoneScoreStrip", () => {
  it("shows PASS from a pre-filtered list when newest raw rows are auto FAILs", () => {
    const raw: InstructorMilestone[] = [
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:08:00", milestone_id: 2 }),
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:07:00", milestone_id: 2 }),
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:06:00", milestone_id: 2 }),
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:05:00", milestone_id: 2 }),
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:04:00", milestone_id: 2 }),
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:03:00", milestone_id: 2 }),
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:02:00", milestone_id: 2 }),
      row({ status: "FAIL", source: "auto", verified_at: "2026-10-20 12:01:00", milestone_id: 2 }),
      row({
        status: "PASS",
        source: "manual",
        verified_at: "2026-10-20 11:00:00",
        milestone_id: 1,
        scenario_id: 1,
      }),
    ]
    // Page contract: filter, then pass into the strip (strip still slices to 8).
    const visible = raw.filter((m) => !isBackgroundAutoFail(m))
    render(<MilestoneScoreStrip milestones={visible} />)
    expect(screen.getByText("PASS")).toBeInTheDocument()
    expect(screen.queryByText("FAIL")).not.toBeInTheDocument()
  })

  it("shows empty copy only when given an empty list", () => {
    render(<MilestoneScoreStrip milestones={[]} />)
    expect(screen.getByText(/No milestone scores recorded yet/i)).toBeInTheDocument()
  })
})
