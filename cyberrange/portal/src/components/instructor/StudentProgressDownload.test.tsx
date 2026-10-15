/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StudentProgressDownload } from "./StudentProgressDownload"
import { instructor } from "@/lib/api"

jest.mock("@/lib/api", () => ({
  instructor: {
    getPodAlerts: jest.fn(),
  },
}))

jest.mock("@/lib/csvExport", () => {
  const actual = jest.requireActual("@/lib/csvExport")
  return {
    ...actual,
    saveBlob: jest.fn(),
  }
})

const milestones = [
  { scenario_id: 6, milestone_id: 4, status: "PASS", detection_score: 0 },
]

describe("StudentProgressDownload", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("keeps the unavailable note when live alerts fail to load", async () => {
    ;(instructor.getPodAlerts as jest.Mock).mockRejectedValue(new Error("manager down"))

    render(
      <StudentProgressDownload
        studentId="srivera"
        milestones={milestones}
        reviews={[]}
        activePodId={7}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /Download scores and logs as CSV/i }))

    await waitFor(() => {
      expect(screen.getByTestId("progress-download-note")).toHaveTextContent(
        "Scores downloaded; live alerts were unavailable.",
      )
    })
    expect(screen.getByRole("button", { name: /Download scores and logs as CSV/i })).not.toBeDisabled()
  })

  it("treats a manager_unavailable payload as alerts failed", async () => {
    ;(instructor.getPodAlerts as jest.Mock).mockResolvedValue({
      pod_id: 7,
      alerts: [],
      total_count: 0,
      query_window_minutes: 60,
      error: "manager_unavailable",
    })

    render(
      <StudentProgressDownload
        studentId="srivera"
        milestones={milestones}
        reviews={[]}
        activePodId={7}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /Download scores and logs as CSV/i }))

    await waitFor(() => {
      expect(screen.getByTestId("progress-download-note")).toHaveTextContent(
        "Scores downloaded; live alerts were unavailable.",
      )
    })
  })
})
