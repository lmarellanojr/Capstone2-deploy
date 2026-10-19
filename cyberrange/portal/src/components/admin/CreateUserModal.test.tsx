/**
 * @jest-environment jsdom
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { CreateUserModal } from "./CreateUserModal";

// Browsers ignore autocomplete="off" on a username + password pair and fill
// in the signed-in admin's saved login (seen live in Chrome). "new-password"
// marks the field as a new credential for someone else.
test("asks the browser not to fill the admin's saved login into the new user's password", () => {
  render(
    <CreateUserModal isOpen onClose={jest.fn()} onCreate={jest.fn()} onCreated={jest.fn()} />
  );
  expect(screen.getByLabelText(/^Initial password/)).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText(/^Username/)).toHaveAttribute("autocomplete", "off");
  for (const label of [/^First name/, /^Last name/, /^Email/]) {
    expect(screen.getByLabelText(label)).toHaveAttribute("autocomplete", "off");
  }
});
