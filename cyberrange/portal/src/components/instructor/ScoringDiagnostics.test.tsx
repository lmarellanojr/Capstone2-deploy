/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, render, screen } from "@testing-library/react"
import { ScoringDiagnostics } from "./ScoringDiagnostics"
import { instructor } from "@/lib/api"
import { DIAGNOSTIC_SCENARIOS, SCENARIO3_REASON_COPY } from "@/lib/scoringDiagnostics"

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
  expect(screen.getByText("Scenario 3 — SIEM Alert Triage")).toBeInTheDocument()
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
  expect(screen.getByText(SCENARIO3_REASON_COPY.CHECK_ERROR.label)).toBeInTheDocument()
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
  expect(screen.getByText(/No checks recorded/)).toBeInTheDocument()
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
  expect(Object.keys(DIAGNOSTIC_SCENARIOS[9].reasons).sort()).toEqual(codes.sort())
})

it("shows Scenario 1 reasons without a file column", async () => {
  await renderWith({
    student_id: "alice", enabled: true, enabled_scenarios: [1], retention_days: 14,
    diagnostics: [{ ...ROW, scenario_id: 1, milestone_id: 4, reason_code: "SESSION_NOT_LIVE", location: "NONE", copies: 0 }],
  })
  expect(screen.getByText("Scenario 1 — Network Reconnaissance & Exploitation")).toBeInTheDocument()
  expect(screen.getByText("4: Tomcat manager exploit")).toBeInTheDocument()
  expect(screen.getByText("Session no longer live")).toBeInTheDocument()
  expect(screen.queryByText("File read from")).not.toBeInTheDocument()
})

it("has copy for every Scenario 1 backend reason code", () => {
  const codes = [
    "NO_POD_ADDRESS", "NO_SUBNET_ROUTE", "COMMAND_NOT_FOUND", "COMMAND_NOT_MATCHED",
    "MSF_NOT_RUNNING", "SESSION_NOT_OPENED", "SESSION_NOT_LIVE", "CHECK_ERROR",
  ]
  expect(Object.keys(DIAGNOSTIC_SCENARIOS[1].reasons).sort()).toEqual(codes.sort())
})

it("groups rows by scenario and labels an unmapped scenario without trusting its code", async () => {
  await renderWith({
    student_id: "alice", enabled: true, retention_days: 14,
    diagnostics: [{ ...ROW, scenario_id: 42, reason_code: "AGENT_MISMATCH", location: null, copies: 0 }, ROW],
  })
  const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)
  expect(headings).toEqual(["Scenario 3 — SIEM Alert Triage", "Scenario id 42"])
  expect(screen.getAllByText("Wrong agent")).toHaveLength(1)
  expect(screen.getByText(SCENARIO3_REASON_COPY.CHECK_ERROR.label)).toBeInTheDocument()
  expect(screen.getAllByText("File read from")).toHaveLength(1)
})
