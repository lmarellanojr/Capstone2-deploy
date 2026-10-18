/** @jest-environment jsdom */
import React from "react"
import "@testing-library/jest-dom"
import { render, screen, within } from "@testing-library/react"
import Page from "./page"

jest.mock("@/components/layout/LayoutWrapper", () => ({
  LayoutWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock("@/components/instructor/StudentAlertsPanel", () => ({ StudentAlertsPanel: () => null }))
jest.mock("@/components/instructor/ScoringDiagnostics", () => ({ ScoringDiagnostics: () => null }))
jest.mock("@/hooks/useStudentProgress", () => ({
  useStudentProgress: () => ({
    loading: false, error: null, forbidden: false, notFound: false,
    student: {
      student_id: "srivera", active_pod: null, reviews: [],
      milestones: [
        { scenario_id: 6, milestone_id: 4, status: "PASS", detection_score: 0 },
        { scenario_id: 9, milestone_id: 1, status: "FAIL", detection_score: 1 },
      ],
    },
  }),
}))

it("shows catalog points with detection scores and offers CSV download", () => {
  render(<Page params={{ id: "srivera" }} />)
  expect(screen.getByRole("columnheader", { name: "Points" })).toBeInTheDocument()
  expect(screen.getByRole("columnheader", { name: "Detection score" })).toBeInTheDocument()
  expect(screen.getByRole("columnheader", { name: "SIEM detection" })).toBeInTheDocument()
  expect(screen.getByText(/Points are the same catalog values the student dashboard uses/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Download scores and logs as CSV/i })).toBeInTheDocument()
  const passRow = within(screen.getByText("Scenario 2").closest("tr")!)
  expect(passRow.getByText("PASS")).toBeInTheDocument()
  expect(passRow.getByText("75")).toBeInTheDocument() // catalog points for Scenario 2 M4
  expect(passRow.getByText("Not configured")).toBeInTheDocument()
  const failRow = within(screen.getByText("Scenario 3").closest("tr")!)
  expect(failRow.getByText("FAIL")).toBeInTheDocument()
  expect(failRow.getByText("Detected")).toBeInTheDocument()
  // FAIL → 0 points; detection_score 1; milestone_id also 1.
  const failCells = failRow.getAllByRole("cell").map((c) => c.textContent)
  expect(failCells.filter((t) => t === "0")).toHaveLength(1)
  expect(failCells.filter((t) => t === "1")).toHaveLength(2)
})
