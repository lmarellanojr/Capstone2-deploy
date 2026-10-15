/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminAuditLogPage from "./page"
import { admin } from "@/lib/api"

jest.mock("@/components/layout/LayoutWrapper", () => ({
  LayoutWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/lib/api", () => ({
  admin: { listAuditLog: jest.fn() },
}))

const listAuditLog = admin.listAuditLog as jest.Mock

const ROWS = [
  { id: 4, event_type: "PROVISION_FAILED", student_id: "student1", pod_id: 3, vmid: null, result: null, detail: "[Errno 110] Connection timed out", timestamp: "2026-10-15 01:00:00" },
  { id: 3, event_type: "REVIEW_CASE_RESOLVED", student_id: "student1", pod_id: null, vmid: null, result: "APPROVED", detail: "review_id=7, score=100, graded_by=SYSTEM_HYBRID", timestamp: "2026-10-15 00:59:00" },
  { id: 2, event_type: "ADMIN_USER_ROLE_SET", student_id: "student2", pod_id: null, vmid: null, result: "OK", detail: "actor=admin_demo role=instructor previous=student", timestamp: "2026-10-15 00:58:00" },
]

beforeEach(() => {
  listAuditLog.mockReset()
  listAuditLog.mockResolvedValue({
    events: ROWS,
    next_before_id: null,
    event_types: ["ADMIN_USER_ROLE_SET", "PROVISION_FAILED", "REVIEW_CASE_RESOLVED"],
  })
  ;(URL as unknown as { createObjectURL: jest.Mock }).createObjectURL = jest.fn(() => "blob:audit")
  ;(URL as unknown as { revokeObjectURL: jest.Mock }).revokeObjectURL = jest.fn()
})

it("opens on admin actions and asks only for admin event types", async () => {
  render(<AdminAuditLogPage />)
  await waitFor(() => expect(listAuditLog).toHaveBeenCalled())
  const filters = listAuditLog.mock.calls[0][0]
  expect(filters.eventTypes).toContain("ADMIN_USER_ROLE_SET")
  expect(filters.eventTypes).not.toContain("PROVISION_FAILED")
  expect(screen.getByRole("button", { name: "Admin actions" })).toHaveAttribute("aria-pressed", "true")
})

it("shows rows in plain language", async () => {
  render(<AdminAuditLogPage />)
  const table = within(await screen.findByRole("table"))
  const row = (label: string) => table.getByText(label).closest("tr") as HTMLElement
  const roleRow = row("Role changed")
  expect(within(roleRow).getByText("admin_demo")).toBeInTheDocument()
  expect(within(roleRow).getByText("Role: Student → Instructor")).toBeInTheDocument()

  const failRow = row("Lab failed to start")
  expect(within(failRow).getByText("System")).toBeInTheDocument()
  expect(within(failRow).getByText("Failed")).toBeInTheDocument()

  const reviewRow = row("Review graded")
  expect(within(reviewRow).getByText("System (auto-grade)")).toBeInTheDocument()
  expect(within(reviewRow).getByText("Review: #7 · Score: 100")).toBeInTheDocument()
  expect(within(reviewRow).getByText("Approved")).toBeInTheDocument()
})

it("All sends no type restriction and offers every type in the dropdown", async () => {
  render(<AdminAuditLogPage />)
  await screen.findByRole("table")
  fireEvent.click(screen.getByRole("button", { name: "All" }))
  await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
  expect(listAuditLog.mock.calls[1][0].eventTypes).toEqual([])
  const options = within(screen.getByLabelText("Event")).getAllByRole("option").map((o) => o.textContent)
  expect(options).toEqual(["All events", "Role changed", "Lab failed to start", "Review graded"])
})

it("Download CSV reuses the current filters and saves a file", async () => {
  const click = jest.fn()
  const originalCreate = document.createElement.bind(document)
  jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = originalCreate(tag)
    if (tag === "a") el.click = click
    return el
  })

  render(<AdminAuditLogPage />)
  await screen.findByRole("table")
  const initialCalls = listAuditLog.mock.calls.length
  fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))

  await waitFor(() => expect(click).toHaveBeenCalled())
  const downloadCall = listAuditLog.mock.calls[initialCalls][0]
  expect(downloadCall.eventTypes).toContain("ADMIN_USER_ROLE_SET")
  expect(downloadCall.eventTypes).not.toContain("PROVISION_FAILED")
  expect(downloadCall.limit).toBe(500)
  expect(URL.createObjectURL).toHaveBeenCalled()
  expect(screen.getByRole("status")).toHaveTextContent(/Downloaded 3 events as audit_log_/)
})
