/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { UserAdminSetupHint, isUserAdminNotConfigured } from "./UserAdminSetupHint"
import { CreateUserModal } from "./CreateUserModal"

// #145: a host that skipped setup_user_admin_client.sh answers every
// /admin/users call with 503 "User management is not configured". The Admin
// must see the fix wherever that error shows up.

describe("UserAdminSetupHint", () => {
  it("names the one-time setup for the not-configured error", () => {
    render(<UserAdminSetupHint message="User management is not configured" />)
    expect(screen.getByText("deploy/host/setup_user_admin_client.sh")).toBeInTheDocument()
    expect(screen.getByText(/restart the provision API/)).toBeInTheDocument()
  })

  it.each([null, undefined, "", "User management service unavailable", "A user with that username already exists"])(
    "renders nothing for %p",
    (message) => {
      const { container } = render(<UserAdminSetupHint message={message} />)
      expect(container).toBeEmptyDOMElement()
      expect(isUserAdminNotConfigured(message)).toBe(false)
    }
  )
})

describe("CreateUserModal on a host without the user-admin client", () => {
  it("shows the setup hint under the error when creation answers not configured", async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error("User management is not configured"))
    render(<CreateUserModal isOpen onClose={jest.fn()} onCreate={onCreate} onCreated={jest.fn()} />)

    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "new_student" } })
    fireEvent.change(screen.getByLabelText(/^Initial password/), { target: { value: "Tmp!pass-1234" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))

    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("User management is not configured")
    expect(alert).toHaveTextContent("setup_user_admin_client.sh")
  })

  it("shows other errors without the setup hint", async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error("A user with that username already exists"))
    render(<CreateUserModal isOpen onClose={jest.fn()} onCreate={onCreate} onCreated={jest.fn()} />)

    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "new_student" } })
    fireEvent.change(screen.getByLabelText(/^Initial password/), { target: { value: "Tmp!pass-1234" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("already exists")
    expect(alert).not.toHaveTextContent("setup_user_admin_client.sh")
  })
})
