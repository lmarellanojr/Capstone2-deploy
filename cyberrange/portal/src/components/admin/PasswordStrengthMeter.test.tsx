/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { PasswordStrengthMeter } from "./PasswordStrengthMeter"

test("shows a continuous bar, must-include checklist, and updates while typing", () => {
  const { rerender } = render(
    <PasswordStrengthMeter password="" labelId="pw-strength" context={{ username: "student_demo" }} />,
  )
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "0")
  expect(screen.getByRole("status")).toHaveTextContent(/Enter a new password/)
  expect(screen.getByRole("status")).toHaveAttribute("id", "pw-strength")
  expect(screen.getByRole("list", { name: "Password requirements" })).toHaveTextContent(/Must be 8–128 characters/)
  expect(screen.getByRole("list", { name: "Password requirements" })).toHaveTextContent(/Must not match your username/)

  rerender(
    <PasswordStrengthMeter password="short" labelId="pw-strength" context={{ username: "student_demo" }} />,
  )
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "1")
  expect(screen.getByRole("status")).toHaveTextContent("Password strength: Weak")
  expect(screen.getByText(/Must be 8–128 characters/).closest("li")).toHaveAttribute("data-met", "false")

  rerender(
    <PasswordStrengthMeter
      password="#!@#%^23456789!@#%^2"
      labelId="pw-strength"
      context={{ username: "student_demo" }}
    />,
  )
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "4")
  expect(screen.getByRole("status")).toHaveTextContent("Password strength: Strong")
  expect(screen.getByText(/Must be 8–128 characters/).closest("li")).toHaveAttribute("data-met", "true")
  expect(screen.queryByText(/Must not reuse your last 3 passwords/)).not.toBeInTheDocument()
  expect(screen.getByText(/Your last 3 passwords are also checked when you save/)).toBeInTheDocument()
})
