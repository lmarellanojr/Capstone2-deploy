/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { StudentAlertsPanel } from "./StudentAlertsPanel"
import type { InstructorPod } from "@/lib/api"

jest.mock("@/components/scenario/SiemAlertViewer", () => ({
  SiemAlertViewer: ({ podId, source }: { podId: number; source?: string }) => (
    <div data-testid="viewer">
      {podId}:{source}
    </div>
  ),
}))

jest.mock("./LabHistory", () => ({
  LabHistory: ({ studentId, scenarioId }: { studentId: string; scenarioId?: unknown }) => (
    <div data-testid="history">
      {studentId}:{String(scenarioId ?? "")}
    </div>
  ),
}))

function pod(overrides: Partial<InstructorPod> = {}): InstructorPod {
  return {
    id: 1,
    student_id: "alice",
    pod_id: 7,
    status: "ACTIVE",
    last_heartbeat: null,
    created_at: null,
    scenario_id: "09",
    ttl_minutes: 30,
    remaining_seconds: 3600,
    expires_at: null,
    ttl_expired: false,
    ...overrides,
  }
}

describe("StudentAlertsPanel", () => {
  it("shows the running lab's alerts through the staff route", () => {
    render(<StudentAlertsPanel studentId="alice" activePod={pod()} />)
    expect(screen.getByTestId("viewer")).toHaveTextContent("7:staff")
    expect(screen.getByText("Read-only")).toBeInTheDocument()
  })

  it.each([null, pod({ status: "PROVISIONING" })])("explains why nothing shows without a running lab (%#)", (p) => {
    render(<StudentAlertsPanel studentId="alice" activePod={p} />)
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument()
    expect(screen.getByText(/No lab running right now/)).toBeInTheDocument()
  })

  it("flags when the running lab is a different scenario than the report", () => {
    render(<StudentAlertsPanel studentId="alice" activePod={pod({ scenario_id: "06" })} scenarioId={9} />)
    expect(screen.getByText(/Their running lab is Scenario 2/)).toBeInTheDocument()
  })

  it("no mismatch note for the same scenario", () => {
    render(<StudentAlertsPanel studentId="alice" activePod={pod()} scenarioId={9} />)
    expect(screen.queryByText(/Their running lab is/)).not.toBeInTheDocument()
  })

  it("always offers Past labs for that student, scoped to the report's scenario", () => {
    render(<StudentAlertsPanel studentId="alice" activePod={null} scenarioId={9} />)
    expect(screen.getByText("Past labs")).toBeInTheDocument()
    expect(screen.getByTestId("history")).toHaveTextContent("alice:9")
  })
})
