/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { TerminalView } from "./TerminalView"
import type { Pod } from "@/lib/api"
import { SCENARIOS, isFlagMilestone } from "@/hooks/useScenarios"

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

const pod: Pod = {
  pod_id: 1,
  student_id: "student",
  status: "ACTIVE",
  vmid_kali: null,
  vmid_meta: null,
  vmid_dvwa: null,
  connection_id: null,
  wazuh_agent_id: null,
  scenario_id: "11",
  created_at: null,
  last_heartbeat: null,
  ttl_hours: 8,
  remaining_seconds: 3600,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  ttl_expired: false,
}

const scenario = SCENARIOS.find((s) => s.id === "11")!

async function renderLab(props: Partial<React.ComponentProps<typeof TerminalView>> = {}) {
  const utils = render(<TerminalView pod={pod} scenario={scenario} onEnd={jest.fn()} {...props} />)
  await act(async () => {
    await Promise.resolve()
  })
  return utils
}

describe("TerminalView — Scenario 4 (Vulnerability Hardening)", () => {
  it("opens on the meta tab, marked as the scored work tab", async () => {
    await renderLab()

    const cardHeader = screen.getByTestId("lab-terminal-card-header")
    expect(within(cardHeader).getByRole("heading", { name: "Target: meta (lab)" })).toBeInTheDocument()
    const metaTab = screen.getByRole("button", { name: /Target: meta \(lab\)\s*Scored/ })
    expect(metaTab).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Kali Linux (CLI)" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("lab-terminal-status-line")).toHaveTextContent(/all scored work happens here/)
  })

  it("shows no DVWA or SIEM surface", async () => {
    await renderLab()

    expect(screen.queryByRole("button", { name: /Open SIEM/i })).not.toBeInTheDocument()
    expect(screen.queryByTitle(/DVWA/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Target: dvwa/ })).not.toBeInTheDocument()
  })

  it("warns that Kali is unscored without opening the attacker explainer", async () => {
    await renderLab()

    fireEvent.click(screen.getByRole("button", { name: "Kali Linux (CLI)" }))

    expect(screen.getByTestId("lab-terminal-status-line")).toHaveTextContent(/not scored/)
    expect(screen.queryByRole("button", { name: "Open Kali terminal" })).not.toBeInTheDocument()
  })

  it("renders the Task 2 cue as a warning", async () => {
    const task2 = scenario.milestones[1]
    await renderLab({ currentTaskId: task2.id, currentTaskCue: task2.cue, currentTaskCueVariant: task2.cueVariant })

    const cue = screen.getByRole("complementary", { name: "Terminal warning" })
    expect(cue).toHaveTextContent(/Empty output = success/)
  })
})

describe("Scenario 4 milestone data", () => {
  it("matches the backend rubric points (50/75/75) and has no flag task", () => {
    expect(scenario.milestones.map((m) => m.points)).toEqual([50, 75, 75])
    expect(scenario.milestones.some((m) => isFlagMilestone("11", m.id))).toBe(false)
  })

  it("states goals (not raw commands) and a cue for every task", () => {
    for (const m of scenario.milestones) {
      expect(m.goal).toBeTruthy()
      expect(m.goal).not.toMatch(/sudo|curl|sed|grep/)
      expect(m.cue).toBeTruthy()
    }
  })
})
