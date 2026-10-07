/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { TerminalView } from "./TerminalView"
import type { Pod } from "@/lib/api"
import type { Scenario } from "@/hooks/useScenarios"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { accessToken: "test-token", user: { name: "Student" } },
    status: "authenticated",
  }),
}))

const mockSuccess = jest.fn()
const mockWarning = jest.fn()
const mockToastError = jest.fn()

jest.mock("@/context/ToastContext", () => ({
  useToastContext: () => ({
    success: mockSuccess,
    warning: mockWarning,
    error: mockToastError,
  }),
}))

jest.mock("@/components/terminal/XtermView", () => ({
  XtermView: () => <div data-testid="xterm-stub" />,
}))

jest.mock("@/components/terminal/terminalSessionManager", () => ({
  destroySession: jest.fn(),
  sessionKey: jest.fn(() => "key"),
}))

jest.mock("@/components/scenario/GuideView", () => ({
  GuideView: () => <div data-testid="guide-stub" />,
}))

// Like GuideView, it renders guide markdown (react-markdown is ESM-only).
jest.mock("@/components/scenario/GuideExtraModal", () => ({
  GuideExtraModal: () => null,
}))

jest.mock("@/components/scenario/SiemAlertViewer", () => ({
  SiemAlertViewer: () => <div data-testid="siem-stub" />,
}))

jest.mock("@/lib/api", () => ({
  provisioning: {
    getMilestones: jest.fn(async () => ({ milestones: [] })),
    getLabUrls: jest.fn(async () => null),
    verifyMilestone: jest.fn(),
  },
}))

// Complete fixtures (no casts) so a change to Pod/Scenario breaks this test
// at compile time instead of hiding behind `as`.
const pod: Pod = {
  pod_id: 1,
  student_id: "student",
  status: "ACTIVE",
  vmid_kali: null,
  vmid_meta: null,
  vmid_dvwa: null,
  connection_id: null,
  wazuh_agent_id: null,
  scenario_id: "09",
  created_at: null,
  last_heartbeat: null,
  ttl_hours: 8,
  remaining_seconds: 3600,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  ttl_expired: false,
}

const scenario: Scenario = {
  id: "09",
  displayNumber: 3,
  name: "SIEM Alert Triage and Log Analysis",
  type: "defensive",
  description: "test",
  mitre: "T1595",
  difficulty: 2,
  guideFile: "scenario_03_siem_alert_triage_and_log_analysis.md",
  milestones: [{ id: 1, name: "M1", description: "d", points: 50 }],
}

describe("TerminalView (LAB-LAYOUT-02)", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it("renders the terminal container with min-w-0 and min-h-0 for grid safety", async () => {
    const { unmount } = render(
      <TerminalView pod={pod} scenario={scenario} onEnd={jest.fn()} />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const containerEl = screen.getByTestId("lab-terminal-container")
    const classes = containerEl.className.split(/\s+/)
    expect(classes).toEqual(
      expect.arrayContaining(["flex", "flex-col", "flex-1", "w-full", "min-w-0", "min-h-0"])
    )
    unmount()
  })

  it("shows the active target title and Open SIEM in the card header for scenario 09", async () => {
    const { unmount } = render(<TerminalView pod={pod} scenario={scenario} onEnd={jest.fn()} />)

    await act(async () => {
      await Promise.resolve()
    })

    const cardHeader = screen.getByTestId("lab-terminal-card-header")
    expect(within(cardHeader).getByRole("heading", { name: "Kali Linux (CLI)" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Open SIEM/i })).toBeInTheDocument()
    // The Kali tab is the student's own attack box, labelled "Host:" not "Target:".
    expect(screen.getByText(/Host:\s*10\.0\.51\.10/)).toBeInTheDocument()
    unmount()
  })

  it("syncs the card title when the Meta strip tab is clicked", async () => {
    const { unmount } = render(<TerminalView pod={pod} scenario={scenario} onEnd={jest.fn()} />)

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole("button", { name: "Target: meta (lab)" }))

    const cardHeader = screen.getByTestId("lab-terminal-card-header")
    expect(within(cardHeader).getByRole("heading", { name: "Target: meta (lab)" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close modal" })).toBeInTheDocument()
    expect(within(cardHeader).getByText(/Target:\s*10\.0\.51\.20/)).toBeInTheDocument()
    unmount()
  })
})
