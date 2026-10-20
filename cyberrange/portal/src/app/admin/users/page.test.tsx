/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen } from "@testing-library/react"
import AdminUsersPage from "./page"
import type { AdminUser } from "@/lib/api"

jest.mock("@/components/layout/LayoutWrapper", () => ({
  LayoutWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "admin_demo" } } }),
}))

jest.mock("@/context/ToastContext", () => ({
  useToastContext: () => ({ success: jest.fn(), error: jest.fn() }),
}))

jest.mock("@/lib/api", () => ({ ADMIN_USERS_MAX: 200, admin: {} }))

const base: AdminUser = {
  id: "", username: "", email: null, first_name: null,
  last_name: null, enabled: true, role: "student", roles: ["student"], created_at: null,
}
const mockInitialUsers: AdminUser[] = [
  { ...base, id: "a", username: "alice" },
  { ...base, id: "b", username: "bob" },
  { ...base, id: "c", username: "carol", role: "instructor", roles: ["instructor"] },
  { ...base, id: "d", username: "dave", enabled: false },
  { ...base, id: "e", username: "eve", enabled: false },
]
// Per-id gates so a test can hold a request in flight and resolve it later.
const mockGates: Record<string, Promise<void>> = {}
const mockSearch = jest.fn()
const mockResearchCalls: { id: string; excluded: boolean; reason?: string }[] = []

jest.mock("@/hooks/useAdminUsers", () => ({
  useAdminUsers: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useState } = require("react") as typeof React
    const [users, setUsers] = useState(mockInitialUsers)
    return {
      users, loading: false, error: null, forbidden: false, pending: {},
      search: mockSearch, refresh: jest.fn(),
      setEnabled: async (id: string, enabled: boolean) => {
        await mockGates[id]
        setUsers((us) => us.map((u) => (u.id === id ? { ...u, enabled } : u)))
      },
      setRole: jest.fn(), resetPassword: jest.fn(), resetMfa: jest.fn(), createUser: jest.fn(),
      setResearchExclusion: async (id: string, excluded: boolean, reason?: string) => {
        mockResearchCalls.push({ id, excluded, reason })
        setUsers((us) =>
          us.map((u) =>
            u.id === id
              ? { ...u, research_excluded: excluded, research_exclusion_reason: excluded ? (reason as AdminUser["research_exclusion_reason"]) : null }
              : u,
          ),
        )
      },
    }
  },
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const setStatus = (value: string) => fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value } })
const setRoleFilter = (value: string) => fireEvent.change(screen.getByLabelText("Filter by role"), { target: { value } })

async function disable(username: string) {
  fireEvent.click(rowButton(username, "Disable"))
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Disable and sign out" }))
  })
}

function rowButton(username: string, label: string) {
  const row = screen.getByText(username, { selector: "p.font-mono" }).closest("tr") as HTMLElement
  return Array.from(row.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as HTMLElement
}

beforeEach(() => {
  for (const id of Object.keys(mockGates)) delete mockGates[id]
  mockResearchCalls.length = 0
})

function openMenu(username: string) {
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${username}` }))
}

it("keeps the table narrow: no reports column, less-used actions in the ⋯ menu", () => {
  render(<AdminUsersPage />)
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
  expect(headers).not.toContain("Research data")
  expect(rowButton("bob", "Reset password")).toBeUndefined()

  openMenu("bob")
  const items = screen.getAllByRole("menuitem").map((i) => i.textContent?.trim())
  expect(items).toEqual(["Reset password", "Reset MFA", "Exclude from reports…"])
})

it("excludes a student from reports with a reason and can include them again (PAPER-16)", async () => {
  render(<AdminUsersPage />)
  openMenu("bob")
  fireEvent.click(screen.getByRole("menuitem", { name: "Exclude from reports…" }))
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "team_member" } })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Exclude from reports" }))
  })
  expect(mockResearchCalls).toEqual([{ id: "b", excluded: true, reason: "team_member" }])
  expect(screen.getByText(/Not in reports ·\s*Team member/)).toBeInTheDocument()

  openMenu("bob")
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Include in reports" }))
  })
  expect(mockResearchCalls[1]).toEqual({ id: "b", excluded: false, reason: undefined })
})

it("staff have no exclude option; the menu says why", () => {
  render(<AdminUsersPage />)
  openMenu("carol")
  const items = screen.getAllByRole("menuitem").map((i) => i.textContent?.trim())
  expect(items).toEqual(["Reset password", "Reset MFA"])
  expect(screen.getByText("Instructors and admins are always left out of reports.")).toBeInTheDocument()
})

it("the menu closes on Escape and returns focus to its button", () => {
  render(<AdminUsersPage />)
  openMenu("alice")
  expect(screen.getByRole("menu")).toBeInTheDocument()
  fireEvent.keyDown(document, { key: "Escape" })
  expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "More actions for alice" })).toHaveFocus()
})

it("the menu is fixed-positioned from its first render and focuses without scrolling", () => {
  const positions: string[] = []
  const focus = jest.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
    const menu = this.closest('[role="menu"]') as HTMLElement | null
    if (menu) positions.push(menu.style.position)
  })
  try {
    render(<AdminUsersPage />)
    openMenu("alice")
    // Focus runs in the layout effect before the measured style commits, so this
    // sees the initial render's style: it must already be fixed.
    expect(positions).toEqual(["fixed"])
    expect(screen.getByRole("menu").style.position).toBe("fixed")
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(focus).toHaveBeenCalled()
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true })
  } finally {
    focus.mockRestore()
  }
})

it("returns focus to the ⋯ button after a dialog opened from the menu is cancelled", () => {
  render(<AdminUsersPage />)
  openMenu("alice")
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset MFA" }))
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.getByRole("button", { name: "More actions for alice" })).toHaveFocus()
})

it("Tab closes the menu", () => {
  render(<AdminUsersPage />)
  openMenu("alice")
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" })
  expect(screen.queryByRole("menu")).not.toBeInTheDocument()
})

it("keeps a just-disabled user visible under Active, then drops it once the view changes", async () => {
  render(<AdminUsersPage />)
  setStatus("active")
  await disable("alice")
  expect(screen.getByText("alice", { selector: "p.font-mono" })).toBeInTheDocument()

  // Leaving and returning to the same view must not resurrect the pin.
  setStatus("all")
  setStatus("active")
  expect(screen.queryByText("alice", { selector: "p.font-mono" })).not.toBeInTheDocument()
})

it("ignores a change that finishes after the Admin moved to another view", async () => {
  const slow = deferred()
  mockGates.d = slow.promise
  render(<AdminUsersPage />)
  setStatus("disabled")

  // Start enabling dave, but hold the request.
  fireEvent.click(rowButton("dave", "Enable"))

  // Move to a new view and pin eve there.
  setRoleFilter("student")
  await act(async () => {
    fireEvent.click(rowButton("eve", "Enable"))
  })
  expect(screen.getByText("eve", { selector: "p.font-mono" })).toBeInTheDocument()

  // dave's late completion must not pin him, nor wipe eve's pin.
  await act(async () => slow.resolve())
  expect(screen.getByText("eve", { selector: "p.font-mono" })).toBeInTheDocument()
  expect(screen.queryByText("dave", { selector: "p.font-mono" })).not.toBeInTheDocument()
})
