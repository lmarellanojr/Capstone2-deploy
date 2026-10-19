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
  it("generates a compliant initial password and submits it", async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error("Password does not meet the Keycloak password policy"))
    render(<CreateUserModal isOpen onClose={jest.fn()} onCreate={onCreate} onCreated={jest.fn()} />)
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "new_student" } })
    fireEvent.click(screen.getByRole("button", { name: "Generate" }))
    const password = (screen.getByLabelText(/^Initial password/) as HTMLInputElement).value
    expect(password).toHaveLength(24)
    expect(password).toMatch(/^[2-9!@#$%*\-_=+]+$/)
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ password })))
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose your own unique")
    expect(screen.getByLabelText(/^Initial password/)).toHaveValue(password)
  })

  it("explains that users can choose a passphrase and generation is optional", () => {
    render(<CreateUserModal isOpen onClose={jest.fn()} onCreate={jest.fn()} onCreated={jest.fn()} />)
    expect(screen.getByText(/Choose your own unique password or passphrase/)).toBeInTheDocument()
    expect(screen.getByText(/Generate is optional/)).toBeInTheDocument()
    expect(screen.getByTestId("password-strength-meter")).toBeInTheDocument()
    expect(screen.getByTestId("password-common-hint")).toBeInTheDocument()
    expect(screen.queryByTestId("password-history-hint")).not.toBeInTheDocument()
    const password = screen.getByLabelText(/^Initial password/)
    expect(password.getAttribute("aria-describedby") || "").toMatch(/common-hint/)
    expect(password.getAttribute("aria-describedby") || "").not.toMatch(/history-hint/)
  })

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
    expect(alert).toHaveTextContent("Verify whether the account was created before sharing credentials")
    expect(screen.getByLabelText(/^Initial password/)).toHaveValue("Tmp!pass-1234")
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

  it("clears the password when an Admin closes and reopens the form", () => {
    const onClose = jest.fn()
    const props = { onClose, onCreate: jest.fn(), onCreated: jest.fn() }
    const { rerender } = render(<CreateUserModal isOpen {...props} />)
    const password = screen.getByLabelText(/^Initial password/)
    fireEvent.change(password, { target: { value: "Tmp!pass-1234" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalled()
    expect(password).toHaveValue("")
    rerender(<CreateUserModal isOpen={false} {...props} />)
    rerender(<CreateUserModal isOpen {...props} />)
    expect(screen.getByLabelText(/^Initial password/)).toHaveValue("")
  })

  it("hands the password to the one-time flow only after successful creation", async () => {
    const created = {
      id: "u1", username: "new_student", email: null, first_name: null, last_name: null,
      enabled: true, role: "student" as const, roles: ["student"], created_at: null,
    }
    const onCreate = jest.fn().mockResolvedValue(created)
    const onCreated = jest.fn()
    render(<CreateUserModal isOpen onClose={jest.fn()} onCreate={onCreate} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "new_student" } })
    fireEvent.change(screen.getByLabelText(/^Initial password/), { target: { value: "Tmp!pass-1234" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created, "Tmp!pass-1234", true))
    expect(screen.getByLabelText(/^Initial password/)).toHaveValue("")
  })
})
