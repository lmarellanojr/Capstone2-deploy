/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { SiemAlertViewer } from "./SiemAlertViewer"
import { POLL_MS } from "./siemAlertQuery"
import { provisioning } from "@/lib/api"

jest.mock("@/lib/api", () => ({
  provisioning: { getAlerts: jest.fn() },
}))

jest.mock("@/context/ToastContext", () => ({
  useToastContext: () => ({ success: jest.fn(), warning: jest.fn() }),
}))

const getAlerts = provisioning.getAlerts as jest.MockedFunction<typeof provisioning.getAlerts>

const ALERTS = [
  {
    timestamp: "2026-09-25T10:00:02.000+0800",
    agent_id: "001",
    agent_name: "pod-alice-meta",
    rule_id: "5710",
    rule_description: "sshd: Attempt to login using a non-existent user",
    rule_level: 5,
  },
  {
    timestamp: "2026-09-25T10:00:01.000+0800",
    agent_id: "002",
    agent_name: "pod-alice-dvwa",
    rule_id: "19007",
    rule_description: "CIS check failed",
    rule_level: 7,
  },
]

function ok(alerts = ALERTS) {
  return { pod_id: 7, alerts, total_count: alerts.length, query_window_minutes: 240 }
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
  document.dispatchEvent(new Event("visibilitychange"))
}

// Flush the awaited getAlerts promise and the resulting state updates.
async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
  await flush()
}

describe("SiemAlertViewer (SIEM-POLL)", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    getAlerts.mockReset()
    getAlerts.mockResolvedValue(ok())
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("fetches on mount and again every POLL_MS without a manual Refresh", async () => {
    render(<SiemAlertViewer podId={7} />)
    await flush()
    expect(getAlerts).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("siem-status")).toHaveTextContent(`auto-refresh every ${POLL_MS / 1000}s`)

    await advance(POLL_MS)
    expect(getAlerts).toHaveBeenCalledTimes(2)
    await advance(POLL_MS)
    expect(getAlerts).toHaveBeenCalledTimes(3)
  })

  it("does not poll while the tab is hidden and catches up once when it returns", async () => {
    render(<SiemAlertViewer podId={7} />)
    await flush()
    expect(getAlerts).toHaveBeenCalledTimes(1)

    act(() => setVisibility("hidden"))
    await advance(POLL_MS * 3)
    expect(getAlerts).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("siem-status")).toHaveTextContent("paused")

    act(() => setVisibility("visible"))
    await flush()
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it("skips an interval tick while the previous request is still in flight", async () => {
    let resolveFirst: (v: ReturnType<typeof ok>) => void = () => {}
    getAlerts.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
    render(<SiemAlertViewer podId={7} />)

    await advance(POLL_MS)
    expect(getAlerts).toHaveBeenCalledTimes(1)

    resolveFirst(ok())
    await flush()
    await advance(POLL_MS)
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it("shows default, active and filtered-empty states and clears back to All", async () => {
    render(<SiemAlertViewer podId={7} />)
    await flush()

    // Default: All, no active-filter summary, both rules visible.
    expect(screen.getByLabelText("Filter by rule")).toHaveValue("")
    expect(screen.getByLabelText("Filter by agent")).toHaveValue("")
    expect(screen.getByLabelText("Filter by severity")).toHaveValue("")
    expect(screen.queryByTestId("siem-filter-summary")).not.toBeInTheDocument()
    expect(screen.getByText("5710")).toBeInTheDocument()
    expect(screen.getByText("19007")).toBeInTheDocument()

    // Active: severity High keeps only 19007.
    fireEvent.change(screen.getByLabelText("Filter by severity"), { target: { value: "high" } })
    expect(screen.getByTestId("siem-filter-summary")).toHaveTextContent("Showing 1 of 2 · severity High (7+)")
    expect(screen.queryByText("5710")).not.toBeInTheDocument()

    // Empty: High + meta agent matches nothing -> filter-specific message, not "No alerts yet".
    fireEvent.change(screen.getByLabelText("Filter by agent"), { target: { value: "pod-alice-meta" } })
    expect(
      screen.getByText("No alerts match agent pod-alice-meta, severity High (7+). 2 alerts hidden by filters.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/No alerts yet/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(screen.queryByTestId("siem-filter-summary")).not.toBeInTheDocument()
    expect(screen.getByText("5710")).toBeInTheDocument()
    expect(screen.getByText("19007")).toBeInTheDocument()
  })

  it("filters by rule ID and keeps the 5710 shortcut server-side", async () => {
    render(<SiemAlertViewer podId={7} />)
    await flush()

    fireEvent.change(screen.getByLabelText("Filter by rule"), { target: { value: "19007" } })
    expect(screen.getByTestId("siem-filter-summary")).toHaveTextContent("Showing 1 of 2 · rule 19007")

    getAlerts.mockResolvedValue(ok([ALERTS[0]]))
    fireEvent.click(screen.getByLabelText("Rule 5710 only"))
    await flush()
    expect(getAlerts).toHaveBeenLastCalledWith(7, { limit: 200, rule_id: "5710" })
    expect(screen.getByLabelText("Filter by rule")).toBeDisabled()
    // The dropdown's 19007 choice must not hide the server-filtered 5710 rows.
    expect(screen.queryByTestId("siem-filter-summary")).not.toBeInTheDocument()
    expect(screen.getByText("5710")).toBeInTheDocument()
  })

  it("keeps the manager_unavailable fallback", async () => {
    getAlerts.mockRejectedValue(new Error("503"))
    render(<SiemAlertViewer podId={7} />)
    await flush()
    expect(screen.getByText(/Manager unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/template files on meta/)).toBeInTheDocument()
  })

  it("states the manager-only / no Indexer-Dashboard constraint", async () => {
    render(<SiemAlertViewer podId={7} />)
    await flush()
    expect(screen.getByText(/Indexer and Dashboard are not deployed on the 12 GiB host profile/)).toBeInTheDocument()
  })
})
