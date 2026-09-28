/** @jest-environment jsdom */
import React from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import { TerminalView } from "./TerminalView"
import { SCENARIOS } from "@/hooks/useScenarios"
import { provisioning } from "@/lib/api"

const mockSuccess = jest.fn()
const mockWarning = jest.fn()
const mockToastError = jest.fn()

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("next-auth/react", () => ({ useSession: () => ({ data: { accessToken: "test-token" } }) }))
jest.mock("@/context/ToastContext", () => ({
  useToastContext: () => ({ success: mockSuccess, warning: mockWarning, error: mockToastError }),
}))
jest.mock("@/lib/api", () => ({
  provisioning: {
    getMilestones: jest.fn(),
    getLabUrls: jest.fn().mockResolvedValue({}),
    verifyMilestone: jest.fn(),
  },
}))
jest.mock("@/components/terminal/XtermView", () => ({ XtermView: () => <div /> }))
jest.mock("@/components/terminal/terminalSessionManager", () => ({
  destroySession: jest.fn(),
  sessionKey: jest.fn(),
}))
jest.mock("@/components/scenario/GuideView", () => ({ GuideView: () => <div /> }))
jest.mock("@/components/scenario/SiemAlertViewer", () => ({ SiemAlertViewer: () => <div /> }))
jest.mock("@/components/progress/MilestoneItem", () => ({ MilestoneItem: () => <div /> }))
jest.mock("@/components/ui", () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <button {...props}>{children}</button>,
  Modal: ({ isOpen, children }: React.PropsWithChildren<{ isOpen: boolean }>) => isOpen ? <div>{children}</div> : null,
  ModalHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
  ModalBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  ModalFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

const pod = (podId: number) => ({
  pod_id: podId,
  student_id: "student",
  status: "ACTIVE" as const,
  vmid_kali: null,
  vmid_meta: null,
  vmid_dvwa: null,
  connection_id: null,
  wazuh_agent_id: null,
  scenario_id: "11",
  created_at: null,
  last_heartbeat: null,
  ttl_hours: 1,
  remaining_seconds: 300,
  expires_at: null,
  ttl_expired: false,
})

const rows = (scenarioId: number, ...milestoneIds: number[]) => ({
  milestones: milestoneIds.map((milestone_id) => ({
    scenario_id: scenarioId,
    milestone_id,
    status: "PASS",
  })),
})

describe("TerminalView completion gates", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("keeps the completion modal closed when initial progress is M2-only", async () => {
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValue(rows(11, 2))
    render(<TerminalView pod={pod(7)} scenario={SCENARIOS.find((s) => s.id === "11")!} onEnd={jest.fn()} />)
    await act(async () => {})
    expect(screen.queryByText("Scenario complete!")).toBeNull()
  })

  it("opens only after initial progress contains this scenario's M1, M2, and M3", async () => {
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValue(rows(11, 1, 2, 3))
    render(<TerminalView pod={pod(7)} scenario={SCENARIOS.find((s) => s.id === "11")!} onEnd={jest.fn()} />)
    await waitFor(() => expect(screen.getByText("Scenario complete!")).toBeTruthy())
  })

  it("does not reuse old completion during a scenario/pod transition or polling", async () => {
    let resolveOld: ((value: { milestones: { scenario_id: number; milestone_id: number; status: string }[] }) => void) | undefined
    ;(provisioning.getMilestones as jest.Mock)
      .mockResolvedValueOnce(rows(9, 1, 2, 3))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce(rows(11, 2))
      .mockResolvedValue({ milestones: [
        ...rows(9, 1, 2, 3).milestones,
        ...rows(11, 2).milestones,
      ] })

    const view = render(<TerminalView pod={pod(6)} scenario={SCENARIOS.find((s) => s.id === "09")!} onEnd={jest.fn()} />)
    await waitFor(() => expect(screen.getByText("Scenario complete!")).toBeTruthy())
    await act(async () => {
      jest.advanceTimersByTime(3000)
      await Promise.resolve()
    })

    view.rerender(<TerminalView pod={pod(7)} scenario={SCENARIOS.find((s) => s.id === "11")!} onEnd={jest.fn()} />)
    expect(screen.queryByText("Scenario complete!")).toBeNull()

    await act(async () => {
      resolveOld?.({ milestones: rows(9, 1, 2, 3).milestones })
      await Promise.resolve()
    })
    await act(async () => {
      jest.advanceTimersByTime(3000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText("Scenario complete!")).toBeNull()
    expect(mockSuccess).not.toHaveBeenCalled()
  })
})
