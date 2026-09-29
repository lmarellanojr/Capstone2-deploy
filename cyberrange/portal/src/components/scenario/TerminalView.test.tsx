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

jest.mock("@/context/ToastContext", () => ({
  useToastContext: () => ({
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
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
  scenario_id: 9,
  status: "ACTIVE",
  student_id: "student",
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  remaining_seconds: 3600,
  ttl_expired: false,
} as Pod

const scenario: Scenario = {
  id: "09",
  displayNumber: 3,
  name: "SIEM Alert Triage and Log Analysis",
  description: "test",
  difficulty: "Intermediate",
  estimatedTime: "2h",
  points: 225,
  milestones: [{ id: 1, name: "M1", description: "d", points: 50 }],
} as Scenario

describe("TerminalView (LAB-LAYOUT-02)", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it("uses a responsive right-panel width instead of fixed w-96", async () => {
    const { container, unmount } = render(
      <TerminalView pod={pod} scenario={scenario} onEnd={jest.fn()} />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const panel = screen.getByTestId("lab-right-panel")
    const classes = panel.className.split(/\s+/)
    expect(classes).toEqual(
      expect.arrayContaining(["w-full", "lg:w-[42%]", "xl:w-[45%]", "lg:min-w-[20rem]", "flex-shrink-0"])
    )
    expect(classes).not.toContain("w-96")

    const root = container.firstElementChild as HTMLElement
    expect(root.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["flex-col", "lg:flex-row"])
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
    expect(screen.getByText(/Target:\s*10\.0\.51\.10/)).toBeInTheDocument()
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
