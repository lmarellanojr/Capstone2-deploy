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
