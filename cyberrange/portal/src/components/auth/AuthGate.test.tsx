/** @jest-environment jsdom */
import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { AuthGate } from "./AuthGate"

jest.mock("next-auth/react", () => ({ useSession: jest.fn() }))
jest.mock("next/navigation", () => ({ usePathname: jest.fn(), useRouter: jest.fn() }))
jest.mock("@/components/ui", () => ({ LoadingSpinner: () => <div>Loading session</div> }))

const sessionMock = useSession as jest.Mock
const pathnameMock = usePathname as jest.Mock
const routerMock = useRouter as jest.Mock
const replace = jest.fn()
const push = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState({}, "", "/")
  routerMock.mockReturnValue({ replace, push })
})

it.each([
  ["/dashboard", ["instructor"], "/instructor"],
  ["/dashboard/", ["admin"], "/admin"],
  ["/dashboard", ["student", "admin"], "/admin"],
  ["/admin/users", ["instructor"], "/instructor"],
  ["/instructor", ["student"], "/dashboard"],
  ["/dashboard", [], "/no-role"],
] as [string, string[], string][])("suppresses children at %s for %j and redirects to %s", (path, roles, target) => {
  pathnameMock.mockReturnValue(path)
  sessionMock.mockReturnValue({ status: "authenticated", data: { user: { roles } } })
  render(<AuthGate><div>Page content</div></AuthGate>)
  expect(screen.queryByText("Page content")).not.toBeInTheDocument()
  expect(replace).toHaveBeenCalledWith(target)
  expect(push).not.toHaveBeenCalled()
})

it.each([
  ["/dashboard", ["student"]],
  ["/instructor/students", ["admin"]],
  ["/instructor", ["instructor"]],
  ["/admin", ["admin"]],
  ["/scenario/2", ["instructor"]],
] as [string, string[]][])("renders permitted %s for %j", (path, roles) => {
  pathnameMock.mockReturnValue(path)
  sessionMock.mockReturnValue({ status: "authenticated", data: { user: { roles } } })
  render(<AuthGate><div>Page content</div></AuthGate>)
  expect(screen.getByText("Page content")).toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
})

it("waits for session resolution before rendering or redirecting", () => {
  pathnameMock.mockReturnValue("/dashboard")
  sessionMock.mockReturnValue({ status: "loading", data: null })
  render(<AuthGate><div>Page content</div></AuthGate>)
  expect(screen.getByText("Loading session")).toBeInTheDocument()
  expect(screen.queryByText("Page content")).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
})

it("preserves the login callback for an unauthenticated visitor", () => {
  pathnameMock.mockReturnValue("/admin/users")
  sessionMock.mockReturnValue({ status: "unauthenticated", data: null })
  render(<AuthGate><div>Page content</div></AuthGate>)
  expect(screen.queryByText("Page content")).not.toBeInTheDocument()
  expect(push).toHaveBeenCalledWith("/login?callbackUrl=%2Fadmin%2Fusers")
  expect(replace).not.toHaveBeenCalled()
})

it("preserves repeated and encoded query values when a session expires client-side", () => {
  const query = "?status=running&tag=one&tag=two&filter=name%3DA%26B&returnTo=%2Fadmin%2Fpods"
  window.history.replaceState({}, "", `/admin/pods${query}#details`)
  pathnameMock.mockReturnValue("/admin/pods")
  sessionMock.mockReturnValue({ status: "unauthenticated", data: null })
  render(<AuthGate><div>Page content</div></AuthGate>)
  const loginUrl = new URL(push.mock.calls[0][0], window.location.origin)
  expect(loginUrl.origin).toBe(window.location.origin)
  expect(loginUrl.pathname).toBe("/login")
  expect(loginUrl.searchParams.get("callbackUrl")).toBe(`/admin/pods${query}`)
  expect(screen.queryByText("Page content")).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})
