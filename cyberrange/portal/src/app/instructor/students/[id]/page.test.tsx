/** @jest-environment jsdom */
import React from "react"
import "@testing-library/jest-dom"
import { render, screen, within, fireEvent } from "@testing-library/react"
import type { InstructorMilestone } from "@/lib/api"
import Page from "./page"

jest.mock("next/navigation", () => ({ useParams: () => ({ id: "srivera" }) }))

jest.mock("@/components/layout/LayoutWrapper", () => ({
  LayoutWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
// Record whether the page omitted the strip (undefined) vs passing a list.
jest.mock("@/components/instructor/StudentAlertsPanel", () => ({
  StudentAlertsPanel: ({ milestones }: { milestones?: InstructorMilestone[] }) => (
    <div data-testid="alerts-panel">
      {milestones === undefined
        ? "strip-omitted"
        : `strip-count-${milestones.length}`}
    </div>
  ),
}))
jest.mock("@/components/instructor/ScoringDiagnostics", () => ({ ScoringDiagnostics: () => null }))

const defaultMilestones: InstructorMilestone[] = [
  { scenario_id: 6, milestone_id: 4, status: "PASS", detection_score: 0, source: "browser" },
  { scenario_id: 9, milestone_id: 1, status: "FAIL", detection_score: 1, source: "manual" },
  { scenario_id: 1, milestone_id: 2, status: "FAIL", detection_score: 0, source: "auto" },
  { scenario_id: 1, milestone_id: 2, status: "FAIL", detection_score: 0, source: "auto" },
]

let mockMilestones: InstructorMilestone[] = defaultMilestones

jest.mock("@/hooks/useStudentProgress", () => ({
  useStudentProgress: () => ({
    loading: false, error: null, forbidden: false, notFound: false,
    student: {
      student_id: "srivera", active_pod: null, reviews: [],
      milestones: mockMilestones,
    },
  }),
}))

beforeEach(() => {
  mockMilestones = defaultMilestones
})

it("shows catalog points with detection scores and offers CSV download", () => {
  render(<Page />)
  expect(screen.getByRole("columnheader", { name: "Points" })).toBeInTheDocument()
  expect(screen.getByRole("columnheader", { name: "Detection score" })).toBeInTheDocument()
  expect(screen.getByRole("columnheader", { name: "SIEM detection" })).toBeInTheDocument()
  expect(screen.getByRole("columnheader", { name: "Source" })).toBeInTheDocument()
  expect(screen.getByText(/Points are the same catalog values the student dashboard uses/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Download scores and logs as CSV/i })).toBeInTheDocument()
  const passRow = within(screen.getByText("Scenario 2").closest("tr")!)
  expect(passRow.getByText("PASS")).toBeInTheDocument()
  expect(passRow.getByText("75")).toBeInTheDocument() // catalog points for Scenario 2 M4
  expect(passRow.getByText("browser")).toBeInTheDocument()
  expect(passRow.getByText("Not configured")).toBeInTheDocument()
  const failRow = within(screen.getByText("Scenario 3").closest("tr")!)
  expect(failRow.getByText("FAIL")).toBeInTheDocument()
  expect(failRow.getByText("manual")).toBeInTheDocument()
  expect(failRow.getByText("Detected")).toBeInTheDocument()
  // FAIL → 0 points; detection_score 1; milestone_id also 1.
  const failCells = failRow.getAllByRole("cell").map((c) => c.textContent)
  expect(failCells.filter((t) => t === "0")).toHaveLength(1)
  expect(failCells.filter((t) => t === "1")).toHaveLength(2)
})

it("hides auto FAIL rows by default and reveals them with the toggle", () => {
  render(<Page />)
  expect(screen.getByRole("button", { name: /Show background checks \(2\)/i })).toBeInTheDocument()
  // Default table has Scenario 2 PASS + Scenario 3 manual FAIL only (no Scenario 1 auto FAIL).
  expect(screen.queryByText("Scenario 1")).not.toBeInTheDocument()
  // Visible non-auto rows are passed to the alerts strip (filter-then-slice contract).
  expect(screen.getByTestId("alerts-panel")).toHaveTextContent("strip-count-2")

  fireEvent.click(screen.getByRole("button", { name: /Show background checks \(2\)/i }))
  expect(screen.getByRole("button", { name: /Hide background checks/i })).toBeInTheDocument()
  expect(screen.getAllByText("Scenario 1").length).toBeGreaterThan(0)
  expect(screen.getAllByText("auto").length).toBeGreaterThan(0)
  expect(screen.getByTestId("alerts-panel")).toHaveTextContent("strip-count-4")
})

it("shows only-background empty copy and omits the strip when every row is auto FAIL", () => {
  mockMilestones = [
    { scenario_id: 1, milestone_id: 1, status: "FAIL", detection_score: 0, source: "auto" },
    { scenario_id: 1, milestone_id: 2, status: "FAIL", detection_score: 0, source: "auto" },
    { scenario_id: 1, milestone_id: 2, status: "FAIL", detection_score: 0, source: "auto" },
  ]
  render(<Page />)
  expect(screen.getByText(/Only background checks \(3\)/i)).toBeInTheDocument()
  expect(screen.queryByText(/No milestone activity yet/i)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Show background checks \(3\)/i })).toBeInTheDocument()
  // Page must omit the strip so it does not claim "No milestone scores recorded yet".
  expect(screen.getByTestId("alerts-panel")).toHaveTextContent("strip-omitted")
})

it("hides the background-checks toggle when there are no auto FAILs", () => {
  mockMilestones = [
    { scenario_id: 6, milestone_id: 4, status: "PASS", detection_score: 0, source: "browser" },
    { scenario_id: 1, milestone_id: 1, status: "FAIL", detection_score: 0, source: "manual" },
  ]
  render(<Page />)
  expect(screen.queryByRole("button", { name: /background checks/i })).not.toBeInTheDocument()
  expect(screen.getByTestId("alerts-panel")).toHaveTextContent("strip-count-2")
})
