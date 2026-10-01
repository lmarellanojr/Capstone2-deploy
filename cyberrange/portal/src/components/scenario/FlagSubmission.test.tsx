/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { FlagSubmission } from "./FlagSubmission"

const mockSubmitFlag = jest.fn()
const mockSuccess = jest.fn()

jest.mock("@/lib/api", () => ({
  provisioning: { submitFlag: (...args: unknown[]) => mockSubmitFlag(...args) },
}))

jest.mock("@/context/ToastContext", () => ({
  useToastContext: () => ({ success: mockSuccess, warning: jest.fn(), error: jest.fn() }),
}))

beforeEach(() => {
  mockSubmitFlag.mockReset()
  mockSuccess.mockReset()
})

function type(value: string) {
  fireEvent.change(screen.getByLabelText(/Submit the flag you found/i), { target: { value } })
}

it("awards the task when the flag is correct (status PASS)", async () => {
  mockSubmitFlag.mockResolvedValue({ status: "PASS", message: "ok" })
  const onPass = jest.fn()
  render(<FlagSubmission scenarioId="01" milestoneId={5} onPass={onPass} />)

  type("FLAG{correct}")
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Submit/i }))
  })

  await waitFor(() => expect(onPass).toHaveBeenCalledTimes(1))
  // Scenario id is sent as a number to the backend.
  expect(mockSubmitFlag).toHaveBeenCalledWith(1, { milestone_id: 5, flag: "FLAG{correct}" })
  expect(mockSuccess).toHaveBeenCalled()
})

it("shows an error and does NOT pass when the flag is wrong (INCOMPLETE)", async () => {
  mockSubmitFlag.mockResolvedValue({ status: "INCOMPLETE", message: "That flag is not correct." })
  const onPass = jest.fn()
  render(<FlagSubmission scenarioId="06" milestoneId={5} onPass={onPass} />)

  type("FLAG{wrong}")
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Submit/i }))
  })

  expect(await screen.findByRole("alert")).toHaveTextContent(/not correct/i)
  expect(onPass).not.toHaveBeenCalled()
})
