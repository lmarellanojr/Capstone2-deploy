/** @jest-environment jsdom */
import React from "react"
import "@testing-library/jest-dom"
import { render, screen, within } from "@testing-library/react"
import Page from "./page"

jest.mock("@/components/layout/LayoutWrapper", () => ({
  LayoutWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock("@/components/instructor/StudentAlertsPanel", () => ({ StudentAlertsPanel: () => null }))
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

it("explains SIEM corroboration without changing milestone outcomes", () => {
  render(<Page params={{ id: "srivera" }} />)
  expect(screen.getByRole("columnheader", { name: "SIEM detection" })).toBeInTheDocument()
  expect(screen.queryByText("Detection Score")).not.toBeInTheDocument()
  expect(screen.getByText(/separately from task completion and points/)).toHaveTextContent(
    "no detection rule is currently configured for that milestone",
  )
  expect(screen.getByText(/separately from task completion and points/)).toHaveTextContent(
    "no matching alert was recorded, or the check did not run",
  )
  const passRow = within(screen.getByText("Scenario 2").closest("tr")!)
  expect(passRow.getByText("PASS")).toBeInTheDocument()
  expect(passRow.getByText("Not configured")).toBeInTheDocument()
  const failRow = within(screen.getByText("Scenario 3").closest("tr")!)
  expect(failRow.getByText("FAIL")).toBeInTheDocument()
  expect(failRow.getByText("Detected")).toBeInTheDocument()
})
