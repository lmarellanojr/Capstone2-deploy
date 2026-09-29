/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { LayoutWrapper } from "./LayoutWrapper"

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}))

jest.mock("next/navigation", () => ({
  usePathname: () => "/scenario/09",
}))

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Student", email: "s@example.com" } },
    status: "authenticated",
  }),
  signOut: jest.fn(),
}))

jest.mock("@/hooks/useScenarios", () => ({
  useScenarios: () => [{ id: "01" }, { id: "06" }, { id: "09" }, { id: "11" }],
}))

describe("LayoutWrapper (LAB-LAYOUT-02)", () => {
  it("shows a desktop brand logo link to /dashboard when hideSidebar is true", () => {
    render(
      <LayoutWrapper hideSidebar>
        <div>lab</div>
      </LayoutWrapper>
    )

    const home = screen.getByRole("link", { name: "MMDC Cyber Range home" })
    expect(home).toHaveAttribute("href", "/dashboard")
    expect(home.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["hidden", "sm:block"])
    )
    expect(home.className.split(/\s+/)).not.toContain("lg:hidden")
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Search labs...")).not.toBeInTheDocument()
  })

  it("keeps the logo tablet-only (lg:hidden) when the sidebar is visible", () => {
    render(
      <LayoutWrapper>
        <div>dashboard</div>
      </LayoutWrapper>
    )

    const home = screen.getByRole("link", { name: "MMDC Cyber Range home" })
    expect(home).toHaveAttribute("href", "/dashboard")
    expect(home.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["hidden", "sm:block", "lg:hidden"])
    )
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Search labs...")).toBeInTheDocument()
  })
})
