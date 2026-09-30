/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, render, screen } from "@testing-library/react"
import { ReportAlertSnapshot } from "./ReportAlertSnapshot"
import { instructor } from "@/lib/api"

jest.mock("@/lib/api", () => ({ instructor: { getReviewAlertSnapshot: jest.fn() } }))
jest.mock("@/components/ui", () => ({ LoadingSpinner: ({ message }: { message: string }) => <p>{message}</p> }))

const getSnapshot = instructor.getReviewAlertSnapshot as jest.Mock

const BASE = {
  review_id: 5,
  pod_id: 1,
  window_start: "2026-09-30 03:38:54",
  window_end: "2026-09-30 04:10:00",
  end_estimated: false,
  total_count: 1,
  error: null,
  captured_at: "2026-09-30 04:10:02",
  alerts: [
    {
      timestamp: "2026-09-30T03:45:00.000+0000",
      agent_id: "012",
      agent_name: "pod-alice-dvwa",
      rule_id: "31103",
      rule_description: "SQL injection attempt",
      rule_level: 7,
    },
  ],
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

it("shows the alerts frozen at submission with their window", async () => {
  getSnapshot.mockResolvedValue({ snapshot: BASE })
  render(<ReportAlertSnapshot reviewId={5} />)
  await flush()

  expect(getSnapshot).toHaveBeenCalledWith(5)
  expect(screen.getByText("SQL injection attempt")).toBeInTheDocument()
  expect(screen.getByTestId("snapshot-meta")).toHaveTextContent("Pod 1")
})

it("explains reports filed before snapshots existed", async () => {
  getSnapshot.mockResolvedValue({ snapshot: null })
  render(<ReportAlertSnapshot reviewId={5} />)
  await flush()
  expect(screen.getByText(/submitted before snapshots were recorded/)).toBeInTheDocument()
})

it("explains a capture that failed or had no lab", async () => {
  getSnapshot.mockResolvedValue({ snapshot: { ...BASE, alerts: [], total_count: 0, error: "no lab found for this scenario" } })
  render(<ReportAlertSnapshot reviewId={5} />)
  await flush()
  expect(screen.getByText(/had no lab for this scenario/)).toBeInTheDocument()
})
