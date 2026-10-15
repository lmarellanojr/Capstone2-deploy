/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import Page from "./page"

jest.mock("@/components/layout/LayoutWrapper", () => ({
  LayoutWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/hooks/useInstructorStudents", () => ({
  useInstructorStudents: () => ({
    loading: false,
    error: null,
    forbidden: false,
    students: [
      {
        student_id: "srivera",
        pending_review_count: 1,
        active_pod: null,
        milestones: [
          { scenario_id: 1, milestone_id: 1, status: "PASS", detection_score: 0, verified_at: "2026-10-15 01:00:00" },
          { scenario_id: 6, milestone_id: 4, status: "PASS", detection_score: 0, verified_at: "2026-10-15 02:00:00" },
          { scenario_id: 6, milestone_id: 1, status: "FAIL", detection_score: 0, verified_at: "2026-10-15 01:30:00" },
        ],
      },
    ],
  }),
}))

it("shows per-scenario chips and expands task-level detail", () => {
  render(<Page />)
  expect(screen.getByText("Progress by scenario")).toBeInTheDocument()
  expect(screen.getByText(/S1/)).toBeInTheDocument()
  expect(screen.getByText(/S2/)).toBeInTheDocument()
  // Scenario 1 M1 (50) + Scenario 2 M4 (75)
  expect(screen.getByText("125")).toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: /Expand srivera/i }))
  expect(screen.getByText(/Host Discovery|Hosts/i)).toBeTruthy()
  expect(screen.getByText(/Open full student detail/i)).toBeInTheDocument()
})
