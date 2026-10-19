/**
 * @jest-environment jsdom
 */

import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResetPasswordModal } from "./ResetPasswordModal";
import type { AdminUser } from "@/lib/api";

const user: AdminUser = {
  id: "u1", username: "student_demo", email: "student@example.test", first_name: null,
  last_name: null, enabled: true, role: "student", roles: ["student"], created_at: null,
};

test("keeps a reset password transiently for reconciliation after an ambiguous failure, then clears on close", async () => {
  const onReset = jest.fn().mockRejectedValue(new Error("User management service unavailable"));
  const onClose = jest.fn();
  render(<ResetPasswordModal user={user} onClose={onClose} onReset={onReset} />);
  const input = screen.getByLabelText(/^New password/);
  fireEvent.change(input, { target: { value: "Tmp!pass-1234" } });
  expect(screen.getByTestId("password-strength-meter")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/Password strength:/);
  expect(screen.getByTestId("password-common-hint")).toBeInTheDocument();
  expect(screen.getByTestId("password-history-hint")).toHaveTextContent(/The user's last 3 passwords/);
  expect(input.getAttribute("aria-describedby") || "").toMatch(/common-hint/);
  expect(input.getAttribute("aria-describedby") || "").toMatch(/history-hint/);
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  const warning = await screen.findByRole("alert");
  expect(warning).toHaveTextContent(/verify whether the reset completed before sharing/i);
  expect(warning).toHaveTextContent(/issue a fresh reset first/i);
  expect(input).toHaveValue("Tmp!pass-1234");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled();
  await waitFor(() => expect(input).toHaveValue(""));
});

test("asks the browser not to fill the admin's saved password into the reset field", () => {
  render(<ResetPasswordModal user={user} onClose={jest.fn()} onReset={jest.fn()} />);
  expect(screen.getByLabelText(/^New password/)).toHaveAttribute("autocomplete", "new-password");
});
