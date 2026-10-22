/** @jest-environment jsdom */
import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import OrientationPage from "./page"

// /orientation is intentionally outside config.matcher (see middleware.test.ts and #292), so the
// page itself is the only guard for a signed-out visitor. These tests pin that behavior.
jest.mock("next-auth/react", () => ({ useSession: jest.fn() }))
jest.mock("next/navigation", () => ({ useRouter: jest.fn(), useSearchParams: jest.fn() }))
jest.mock("@/components/ui", () => ({
  Button: ({ children, loading, variant, size, ...props }: any) => <button {...props}>{children}</button>,
  LoadingSpinner: ({ message }: { message: string }) => <p>{message}</p>,
}))
jest.mock("@/lib/api", () => ({ onboarding: { completeOrientation: jest.fn() } }))

const sessionMock = useSession as jest.Mock
const routerMock = useRouter as jest.Mock
const searchParamsMock = useSearchParams as jest.Mock
const replace = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  routerMock.mockReturnValue({ replace })
  searchParamsMock.mockReturnValue(new URLSearchParams())
})

it("sends a signed-out visitor to /login and shows no orientation content", () => {
  sessionMock.mockReturnValue({ status: "unauthenticated", data: null })
  render(<OrientationPage />)
  expect(replace).toHaveBeenCalledWith("/login?callbackUrl=/orientation")
  expect(screen.queryByText("Welcome to your lab orientation")).not.toBeInTheDocument()
})

it("waits without redirecting while the session is loading", () => {
  sessionMock.mockReturnValue({ status: "loading", data: null })
  render(<OrientationPage />)
  expect(replace).not.toHaveBeenCalled()
  expect(screen.queryByText("Welcome to your lab orientation")).not.toBeInTheDocument()
})

it("shows the orientation to a signed-in user without redirecting", () => {
  sessionMock.mockReturnValue({ status: "authenticated", data: { user: { roles: ["student"] } } })
  render(<OrientationPage />)
  expect(replace).not.toHaveBeenCalled()
  expect(screen.getByText("Welcome to your lab orientation")).toBeInTheDocument()
})
