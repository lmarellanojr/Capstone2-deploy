/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import LoginPage from "./page"
import { signIn, useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"

jest.mock("next-auth/react", () => ({
  signIn: jest.fn(),
  useSession: jest.fn(),
}))

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

describe("LoginPage (AUTH-06)", () => {
  const mockPush = jest.fn()
  const mockSignIn = signIn as jest.MockedFunction<typeof signIn>
  const mockUseSession = useSession as jest.MockedFunction<typeof useSession>
  const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
  const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>

  let searchParamsStore: Record<string, string | null> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    searchParamsStore = {}

    mockUseRouter.mockReturnValue({
      push: mockPush,
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
    } as any)

    mockUseSearchParams.mockImplementation(() => ({
      get: (param: string) => searchParamsStore[param] ?? null,
    } as any))

    mockUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
    } as any)

    mockSignIn.mockResolvedValue(undefined as any)
  })

  describe("UI Rendering & Copy Simplification (Issue #94)", () => {
    it("renders the primary button labeled 'Log in' and does NOT contain 'Continue with school SSO'", () => {
      render(<LoginPage />)

      const logInButton = screen.getByRole("button", { name: "Log in" })
      expect(logInButton).toBeInTheDocument()
      expect(screen.queryByText(/continue with school sso/i)).not.toBeInTheDocument()
    })

    it("renders clarified Keycloak demo account supporting text", () => {
      render(<LoginPage />)

      expect(
        screen.getByText("Secure authentication via Keycloak demo accounts")
      ).toBeInTheDocument()
      expect(
        screen.getByText("Sign in with your assigned student, instructor, or admin credentials")
      ).toBeInTheDocument()
    })

    it("renders standard Sign in header and lab subtitle", () => {
      render(<LoginPage />)

      expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument()
      expect(
        screen.getByText("Access your cybersecurity training labs")
      ).toBeInTheDocument()
    })
  })

  describe("Authentication Dispatch & Loading State", () => {
    it("dispatches signIn('keycloak') with /login returnTo when no callbackUrl is provided", async () => {
      render(<LoginPage />)

      const button = screen.getByRole("button", { name: "Log in" })
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith("keycloak", {
          callbackUrl: "/login",
          redirect: true,
        })
      })
    })

    it("dispatches signIn('keycloak') preserving safe same-origin callbackUrl", async () => {
      searchParamsStore["callbackUrl"] = "/scenario/06"
      render(<LoginPage />)

      const button = screen.getByRole("button", { name: "Log in" })
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith("keycloak", {
          callbackUrl: "/login?callbackUrl=%2Fscenario%2F06",
          redirect: true,
        })
      })
    })

    it("transitions button to disabled and displays 'Logging in...' during dispatch and stays loading on resolution", async () => {
      let resolveSignIn: () => void = () => {}
      mockSignIn.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSignIn = resolve as any
          })
      )

      render(<LoginPage />)

      const button = screen.getByRole("button", { name: "Log in" })
      fireEvent.click(button)

      // Button should now be disabled and show loading indicator
      expect(button).toBeDisabled()
      expect(screen.getByText("Logging in...")).toBeInTheDocument()

      // Concurrency guard: additional clicks should not trigger another signIn call
      fireEvent.click(button)
      expect(mockSignIn).toHaveBeenCalledTimes(1)

      // On happy path, signIn initiates browser redirect; button remains disabled/loading
      // to avoid visual flicker before browser unloads (Leo review PR #100)
      await act(async () => {
        resolveSignIn()
      })

      expect(button).toBeDisabled()
      expect(screen.getByText("Logging in...")).toBeInTheDocument()
    })

    it("resets loading state, logs error to console, and renders alert when signIn rejects", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {})
      mockSignIn.mockRejectedValueOnce(new Error("Network failure"))

      render(<LoginPage />)

      const button = screen.getByRole("button", { name: "Log in" })
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledTimes(1)
        expect(button).not.toBeDisabled()
        expect(screen.getByText("Sign In Failed")).toBeInTheDocument()
        expect(
          screen.getByText("Unable to connect to authentication service. Please try again.")
        ).toBeInTheDocument()
        expect(consoleSpy).toHaveBeenCalledWith("Login dispatch failed:", expect.any(Error))
      })

      consoleSpy.mockRestore()
    })
  })

  describe("Anti Agent Security Regression Guards", () => {
    it("sanitizes malicious cross-origin callbackUrl on click dispatch", async () => {
      searchParamsStore["callbackUrl"] = "https://evil.example/steal"
      render(<LoginPage />)

      const button = screen.getByRole("button", { name: "Log in" })
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith("keycloak", {
          callbackUrl: "/login",
          redirect: true,
        })
      })
    })

    it("sanitizes protocol-relative callbackUrl on click dispatch", async () => {
      searchParamsStore["callbackUrl"] = "//evil.example"
      render(<LoginPage />)

      const button = screen.getByRole("button", { name: "Log in" })
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith("keycloak", {
          callbackUrl: "/login",
          redirect: true,
        })
      })
    })

    it("sanitizes malicious callbackUrl on post-login routing and falls back to role landing path", () => {
      searchParamsStore["callbackUrl"] = "https://evil.example/phish"
      mockUseSession.mockReturnValue({
        data: { user: { roles: ["student"] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(mockPush).toHaveBeenCalledWith("/dashboard")
      expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining("evil.example"))
    })

    it("blocks privilege boundary traversal via callbackUrl (student cannot deep-link to /admin)", () => {
      searchParamsStore["callbackUrl"] = "/admin/pods"
      mockUseSession.mockReturnValue({
        data: { user: { roles: ["student"] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(mockPush).toHaveBeenCalledWith("/dashboard")
    })

    it("strictly isolates role-less accounts by routing to /no-role even with a deep link", () => {
      searchParamsStore["callbackUrl"] = "/scenario/06"
      mockUseSession.mockReturnValue({
        data: { user: { roles: [] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(mockPush).toHaveBeenCalledWith("/no-role")
    })
  })

  describe("Post-Login Role-Based Routing (AUTH-05 Contract)", () => {
    it("routes student_demo (roles: ['student']) to /dashboard", () => {
      mockUseSession.mockReturnValue({
        data: { user: { roles: ["student"] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(mockPush).toHaveBeenCalledWith("/dashboard")
    })

    it("routes instructor_demo (roles: ['instructor']) to /instructor", () => {
      mockUseSession.mockReturnValue({
        data: { user: { roles: ["instructor"] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(mockPush).toHaveBeenCalledWith("/instructor")
    })

    it("routes admin_demo (roles: ['admin']) to /admin", () => {
      mockUseSession.mockReturnValue({
        data: { user: { roles: ["admin"] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(mockPush).toHaveBeenCalledWith("/admin")
    })

    it("honors authorized deep link for instructor (/instructor/students)", () => {
      searchParamsStore["callbackUrl"] = "/instructor/students"
      mockUseSession.mockReturnValue({
        data: { user: { roles: ["instructor"] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(mockPush).toHaveBeenCalledWith("/instructor/students")
    })
  })

  describe("Session Edge Cases", () => {
    it("displays loading spinner when session status is loading", () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: "loading",
      } as any)

      render(<LoginPage />)

      expect(screen.getByText("Loading...")).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument()
    })

    it("renders Session Expired banner and does NOT auto-redirect when error=SessionExpired", () => {
      searchParamsStore["error"] = "SessionExpired"
      mockUseSession.mockReturnValue({
        data: { user: { roles: ["student"] } },
        status: "authenticated",
      } as any)

      render(<LoginPage />)

      expect(screen.getByText("Session Expired")).toBeInTheDocument()
      expect(
        screen.getByText("Your authentication token has expired. Please sign in again.")
      ).toBeInTheDocument()
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
