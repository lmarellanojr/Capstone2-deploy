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
  // Scenario 1 M1 (50) + Scenario 2 M4 (75); FAIL on S2 M1 does not add points.
  expect(screen.getByText("125")).toBeInTheDocument()
  const s1Chip = screen.getByTitle(/Network Reconnaissance/i)
  expect(s1Chip).toHaveTextContent("S1")
  expect(s1Chip).toHaveTextContent("1/5")
  expect(s1Chip).toHaveTextContent("50 pts")
  const s2Chip = screen.getByTitle(/SQL Injection|Web Application/i)
  expect(s2Chip).toHaveTextContent("S2")
  expect(s2Chip).toHaveTextContent("1/5")
  expect(s2Chip).toHaveTextContent("75 pts")

  fireEvent.click(screen.getByRole("button", { name: /Expand srivera/i }))
  expect(screen.getByText("M1 · Host Discovery")).toBeInTheDocument()
  expect(screen.getByText(/Open full student detail/i)).toBeInTheDocument()
})
