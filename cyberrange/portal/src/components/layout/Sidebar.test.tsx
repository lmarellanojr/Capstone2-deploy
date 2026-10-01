/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { Sidebar } from "./Sidebar"
import { instructorNavItems } from "@/lib/navigation"

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

let mockPathname = "/instructor"
let mockRoles: string[] = []

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}))

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "User", email: "u@example.com", roles: mockRoles } },
    status: "authenticated",
  }),
}))

jest.mock("@/hooks/useScenarios", () => ({
  useScenarios: () => [],
}))

describe("Sidebar Back to Admin switch", () => {
  it("shows for an Admin in the Instructor view", () => {
    mockPathname = "/instructor/pods"
    mockRoles = ["admin"]
    render(<Sidebar navItems={instructorNavItems} sectionLabel="Instructor" />)
    expect(screen.getByRole("link", { name: "Back to Admin" })).toHaveAttribute("href", "/admin")
  })

  it("is hidden from Instructors", () => {
    mockPathname = "/instructor/pods"
    mockRoles = ["instructor"]
    render(<Sidebar navItems={instructorNavItems} sectionLabel="Instructor" />)
    expect(screen.queryByRole("link", { name: "Back to Admin" })).not.toBeInTheDocument()
  })

  it("is hidden while the Admin is already in the Admin section", () => {
    mockPathname = "/admin/users"
    mockRoles = ["admin"]
    render(<Sidebar navItems={instructorNavItems} />)
    expect(screen.queryByRole("link", { name: "Back to Admin" })).not.toBeInTheDocument()
  })
})
