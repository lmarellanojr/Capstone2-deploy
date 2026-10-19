/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, render, screen } from "@testing-library/react"
import { ScoringDiagnostics } from "./ScoringDiagnostics"
import { instructor } from "@/lib/api"
import { REASON_COPY } from "@/lib/scoringDiagnostics"

jest.mock("@/lib/api", () => ({ instructor: { getStudentDiagnostics: jest.fn() } }))
jest.mock("@/components/ui", () => ({
  LoadingSpinner: ({ message }: { message: string }) => <p>{message}</p>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

const getStudentDiagnostics = instructor.getStudentDiagnostics as jest.Mock

const ROW = {
  pod_id: 3,
  pod_created_at: "2026-10-01 14:00:00",
  lab_session_id: 7,
  scenario_id: 9,
  milestone_id: 1,
  status: "FAIL",
  reason_code: "AGENT_MISMATCH",
  location: "HOME_MSFADMIN",
  copies: 2,
  check_count: 4,
  first_seen_at: "2026-10-01 14:05:00",
  last_seen_at: "2026-10-01 14:09:00",
}

async function renderWith(data: unknown) {
  getStudentDiagnostics.mockReset().mockResolvedValue(data)
  const view = render(<ScoringDiagnostics studentId="alice" />)
  await act(async () => {
    await Promise.resolve()
  })
  return view
}

it("shows the reason, where the file was read, and duplicate copies", async () => {
  await renderWith({ student_id: "alice", enabled: true, retention_days: 14, diagnostics: [ROW] })
  expect(getStudentDiagnostics).toHaveBeenCalledWith("alice")
  expect(screen.getByText("Wrong agent")).toBeInTheDocument()
  expect(screen.getByText("1: Triage record")).toBeInTheDocument()
  expect(screen.getByText("/home/msfadmin")).toBeInTheDocument()
  expect(screen.getByText(/2 copies found/)).toBeInTheDocument()
  expect(screen.getByText(/Kept for 14 days/)).toBeInTheDocument()
})

it("shows a passed milestone without a reason", async () => {
  await renderWith({
    student_id: "alice", enabled: true, retention_days: 14,
    diagnostics: [{ ...ROW, status: "PASS", reason_code: null, copies: 1 }],
  })
  expect(screen.getByText("PASS")).toBeInTheDocument()
  expect(screen.queryByText("Wrong agent")).not.toBeInTheDocument()
  expect(screen.queryByText(/copies found/)).not.toBeInTheDocument()
})

it("never renders an unknown code or markup as-is", async () => {
  await renderWith({
    student_id: "alice", enabled: true, retention_days: 14,
    diagnostics: [{ ...ROW, reason_code: "<img src=x onerror=alert(1)>", location: "<b>/etc</b>" }],
  })
  expect(screen.getByText(REASON_COPY.CHECK_ERROR.label)).toBeInTheDocument()
  expect(document.querySelector("img")).toBeNull()
  expect(document.body.innerHTML).not.toContain("onerror")
  expect(document.body.innerHTML).not.toContain("/etc")
})

it("renders nothing when the feature is off and nothing is kept", async () => {
  const { container } = await renderWith({ student_id: "alice", enabled: false, retention_days: 14, diagnostics: [] })
  expect(container).toBeEmptyDOMElement()
})

it("says so when enabled but empty", async () => {
  await renderWith({ student_id: "alice", enabled: true, retention_days: 14, diagnostics: [] })
  expect(screen.getByText(/No Scenario 3 checks recorded/)).toBeInTheDocument()
})

it("reports a load error", async () => {
  getStudentDiagnostics.mockReset().mockRejectedValue({ response: { status: 403 } })
  render(<ScoringDiagnostics studentId="alice" />)
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.getByText(/Could not load check reasons/)).toBeInTheDocument()
})

it("has copy for every backend reason code", () => {
  const codes = [
    "ARTIFACT_MISSING", "ARTIFACT_UNREADABLE", "ARTIFACT_INVALID", "PLACEHOLDER_OR_EXAMPLE",
    "AGENT_MISSING", "AGENT_MISMATCH", "RULE_MISSING", "RULE_MISMATCH",
    "TIMESTAMP_MISSING", "TIMESTAMP_NOT_MATCHED", "REPORT_TOO_SHORT", "REPORT_BODY_TOO_SHORT", "CHECK_ERROR",
  ]
  expect(Object.keys(REASON_COPY).sort()).toEqual(codes.sort())
})
