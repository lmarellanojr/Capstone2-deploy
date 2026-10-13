/**
 * @jest-environment jsdom
 */

import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { CredentialHandoffModal, CREDENTIAL_HANDOFF_TIMEOUT_MS } from "./CredentialHandoffModal";

jest.mock("@/lib/copyToClipboard", () => ({ copyToClipboard: jest.fn() }));
const mockedCopy = copyToClipboard as jest.MockedFunction<typeof copyToClipboard>;
const credentials = { username: "student_demo", password: "Tmp!pass-1234", temporary: true };

beforeEach(() => mockedCopy.mockReset().mockResolvedValue(true));
afterEach(() => jest.useRealTimers());

test("copies credentials only after an explicit action and closes on request", async () => {
  const onClose = jest.fn();
  render(<CredentialHandoffModal credentials={credentials} onClose={onClose} />);
  expect(screen.getByText("••••••••••••")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByText("Tmp!pass-1234")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy credentials" }));
  await waitFor(() => expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining("Password: Tmp!pass-1234")));
  expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining("Username: student_demo"));
  fireEvent.click(screen.getByRole("button", { name: "Close and clear" }));
  expect(onClose).toHaveBeenCalled();
});

test("clears the handoff by closing it after two minutes", () => {
  jest.useFakeTimers();
  const onClose = jest.fn();
  render(<CredentialHandoffModal credentials={credentials} onClose={onClose} />);
  act(() => jest.advanceTimersByTime(CREDENTIAL_HANDOFF_TIMEOUT_MS));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("enforces expiry when a throttled background tab becomes visible", () => {
  jest.useFakeTimers();
  const onClose = jest.fn();
  render(<CredentialHandoffModal credentials={credentials} onClose={onClose} />);
  act(() => jest.setSystemTime(Date.now() + CREDENTIAL_HANDOFF_TIMEOUT_MS + 1));
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("refuses to copy credentials after the absolute expiry", async () => {
  jest.useFakeTimers();
  const onClose = jest.fn();
  render(<CredentialHandoffModal credentials={credentials} onClose={onClose} />);
  act(() => jest.setSystemTime(Date.now() + CREDENTIAL_HANDOFF_TIMEOUT_MS + 1));
  fireEvent.click(screen.getByRole("button", { name: "Copy credentials" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mockedCopy).not.toHaveBeenCalled();
});
