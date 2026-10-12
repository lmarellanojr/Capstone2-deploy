/** @jest-environment jsdom */
import React from "react"
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { onboarding } from "@/lib/api"
import { OnboardingGate } from "./OnboardingGate"

jest.mock("next-auth/react", () => ({ useSession: jest.fn() }))
jest.mock("next/navigation", () => ({ usePathname: jest.fn(), useRouter: jest.fn() }))
jest.mock("@/components/ui", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  LoadingSpinner: () => <div>Checking orientation...</div>,
}))
jest.mock("@/lib/api", () => ({ onboarding: { getOrientation: jest.fn() } }))

const sessionMock = useSession as jest.Mock
const pathnameMock = usePathname as jest.Mock
const routerMock = useRouter as jest.Mock
const getOrientationMock = onboarding.getOrientation as jest.Mock
const replace = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  pathnameMock.mockReturnValue("/dashboard")
  window.history.replaceState({}, "", "/dashboard")
  routerMock.mockReturnValue({ replace })
})

it("does not call the onboarding API for a role-less account", () => {
  sessionMock.mockReturnValue({ status: "authenticated", data: { user: { roles: [] } } })
  render(<OnboardingGate><div>Page content</div></OnboardingGate>)
  expect(screen.getByText("Page content")).toBeInTheDocument()
  expect(getOrientationMock).not.toHaveBeenCalled()
})

it("redirects an incomplete user with the full local query string", async () => {
  pathnameMock.mockReturnValue("/scenarios")
  window.history.replaceState({}, "", "/scenarios?tab=defensive&tag=one")
  sessionMock.mockReturnValue({ status: "authenticated", data: { user: { roles: ["student"], email: "student@example.test" } } })
  getOrientationMock.mockResolvedValue({ completed: false })
  render(<OnboardingGate><div>Page content</div></OnboardingGate>)
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/orientation?returnTo=%2Fscenarios%3Ftab%3Ddefensive%26tag%3Done"))
})

it("shows retry UI when the onboarding check fails", async () => {
  sessionMock.mockReturnValue({ status: "authenticated", data: { user: { roles: ["student"], email: "student@example.test" } } })
  getOrientationMock.mockRejectedValue(new Error("unavailable"))
  render(<OnboardingGate><div>Page content</div></OnboardingGate>)
  await waitFor(() => expect(screen.getByText("Orientation check unavailable")).toBeInTheDocument())
  expect(replace).not.toHaveBeenCalled()
})
