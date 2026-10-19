/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { PasswordStrengthMeter } from "./PasswordStrengthMeter"

test("shows a continuous bar and updates the live strength label", () => {
  const { rerender } = render(<PasswordStrengthMeter password="" labelId="pw-strength" />)
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "0")
  expect(screen.getByRole("status")).toHaveTextContent(/Enter a new password/)
  expect(screen.getByRole("status")).toHaveAttribute("id", "pw-strength")

  rerender(<PasswordStrengthMeter password="short" labelId="pw-strength" />)
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "1")
  expect(screen.getByRole("status")).toHaveTextContent("Password strength: Weak")

  rerender(<PasswordStrengthMeter password="#!@#%^23456789!@#%^2" labelId="pw-strength" />)
  expect(screen.getByTestId("password-strength-meter")).toHaveAttribute("data-score", "4")
  expect(screen.getByRole("status")).toHaveTextContent("Password strength: Strong")
})
