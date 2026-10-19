/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { PasswordStrengthMeter } from "./PasswordStrengthMeter"
import { PASSWORD_HISTORY_HINT_ADMIN } from "@/lib/passwordStrength"

test("shows a continuous bar, must-include checklist, and dual save-time hints", () => {
  const { rerender } = render(
    <PasswordStrengthMeter
      password=""
      labelId="pw-strength"
      audience="admin"
      historyHint={null}
      context={{ username: "student_demo" }}
    />,
  )
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "0")
  expect(screen.getByRole("status")).toHaveTextContent(/Enter a new password/)
  expect(screen.getByRole("list", { name: "Password requirements" })).toHaveTextContent(/Must be 8–128 characters/)
  expect(screen.getByRole("list", { name: "Password requirements" })).toHaveTextContent(/Must not match the username/)
  expect(screen.getByTestId("password-common-hint")).toHaveTextContent(/Common passwords are checked when you save/)
  expect(screen.queryByTestId("password-history-hint")).not.toBeInTheDocument()
  expect(screen.queryByText(/Must not be a common password/)).not.toBeInTheDocument()

  rerender(
    <PasswordStrengthMeter
      password="short"
      labelId="pw-strength"
      audience="admin"
      historyHint={PASSWORD_HISTORY_HINT_ADMIN}
      context={{ username: "student_demo" }}
    />,
  )
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "1")
  expect(screen.getByRole("status")).toHaveTextContent("Password strength: Weak")
  expect(screen.getByText(/Must be 8–128 characters/).closest("li")).toHaveAttribute("data-met", "false")
  expect(screen.getByTestId("password-history-hint")).toHaveTextContent(/The user's last 3 passwords/)

  rerender(
    <PasswordStrengthMeter
      password="#!@#%^23456789!@#%^2"
      labelId="pw-strength"
      audience="admin"
      historyHint={PASSWORD_HISTORY_HINT_ADMIN}
      context={{ username: "student_demo" }}
    />,
  )
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "4")
  expect(screen.getByRole("status")).toHaveTextContent("Password strength: Strong")
  expect(screen.getByText(/Must be 8–128 characters/).closest("li")).toHaveAttribute("data-met", "true")
})
