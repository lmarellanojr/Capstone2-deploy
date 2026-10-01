/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { LabHistory } from "./LabHistory"
import { instructor } from "@/lib/api"

jest.mock("@/lib/api", () => ({
  instructor: { listStudentLabs: jest.fn(), getLabAlerts: jest.fn() },
}))
jest.mock("@/components/ui", () => ({ LoadingSpinner: ({ message }: { message: string }) => <p>{message}</p> }))

const listStudentLabs = instructor.listStudentLabs as jest.Mock
const getLabAlerts = instructor.getLabAlerts as jest.Mock

const RUNNING = { pod_id: 1, scenario_id: "06", started_at: "2026-09-30 03:38:54", ended_at: null, active: true, end_estimated: false }
const OLD = { pod_id: 1, scenario_id: "09", started_at: "2026-09-20 08:00:00", ended_at: "2026-09-20 10:00:00", active: false, end_estimated: true }
const ALERT = {
  timestamp: "2026-09-20T08:05:00.000+0000",
  agent_id: "012",
  agent_name: "pod-alice-meta",
  rule_id: "5710",
  rule_description: "sshd: attempt to login using a non-existent user",
  rule_level: 5,
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  listStudentLabs.mockReset().mockResolvedValue({ student_id: "alice", labs: [RUNNING, OLD] })
  getLabAlerts.mockReset()
})

it("lists labs with running and estimated-end markers, flagging the report's scenario", async () => {
  render(<LabHistory studentId="alice" scenarioId={9} />)
  await flush()

  expect(screen.getByText("Scenario 2")).toBeInTheDocument()
  expect(screen.getByText("running")).toBeInTheDocument()
  expect(screen.getByText("Scenario 3")).toBeInTheDocument()
  expect(screen.getByTitle(/End time estimated/)).toBeInTheDocument()
  expect(screen.getAllByText("This report's scenario")).toHaveLength(1)
})

it("loads a lab's archived alerts by (pod, start) when opened", async () => {
  getLabAlerts.mockResolvedValue({ lab: OLD, alerts: [ALERT], total_count: 1 })
  render(<LabHistory studentId="alice" />)
  await flush()

  fireEvent.click(screen.getAllByRole("button")[1])
  await flush()

  expect(getLabAlerts).toHaveBeenCalledWith("alice", 1, "2026-09-20 08:00:00")
  expect(screen.getByText("sshd: attempt to login using a non-existent user")).toBeInTheDocument()
  expect(screen.getByText(/ran before end times were recorded/)).toBeInTheDocument()
})

it("explains a SIEM outage instead of an empty table", async () => {
  getLabAlerts.mockRejectedValue({ response: { status: 503, data: { error: "manager_unavailable" } } })
  render(<LabHistory studentId="alice" />)
  await flush()

  fireEvent.click(screen.getAllByRole("button")[0])
  await flush()

  expect(screen.getByText(/SIEM can't be reached/)).toBeInTheDocument()
})

it("says when the student has no labs", async () => {
  listStudentLabs.mockResolvedValue({ student_id: "alice", labs: [] })
  render(<LabHistory studentId="alice" />)
  await flush()
  expect(screen.getByText(/hasn't run any labs yet/)).toBeInTheDocument()
})
