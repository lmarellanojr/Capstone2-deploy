/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { VerificationRequestModal } from "./VerificationRequestModal"

beforeAll(() => {
  // jsdom has no object URLs.
  let n = 0
  global.URL.createObjectURL = jest.fn(() => `blob:preview-${++n}`)
  global.URL.revokeObjectURL = jest.fn()
})

function png(name: string) {
  return new File([new Uint8Array(20)], name, { type: "image/png" })
}

function pick(files: File[]) {
  const input = screen.getByTestId("screenshot-input") as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

function setup(onSubmit = jest.fn().mockResolvedValue(undefined)) {
  render(
    <VerificationRequestModal isOpen onClose={jest.fn()} taskName="Start Triage" scenarioLabel="Scenario 3" onSubmit={onSubmit} />
  )
  return onSubmit
}

it("previews picked screenshots and sends them with the request", async () => {
  const onSubmit = setup()
  pick([png("login.png"), png("siem.png")])

  expect(screen.getByAltText(/Screenshot 1: login\.png/)).toBeInTheDocument()
  expect(screen.getByAltText(/Screenshot 2: siem\.png/)).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText(/What did you do/), {
    target: { value: "I wrote alert_triage.json on meta but it did not score." },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Send request/ }))
  })

  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0].images.map((f: File) => f.name)).toEqual(["login.png", "siem.png"])
})

it("can remove a picked screenshot", () => {
  setup()
  pick([png("a.png"), png("b.png")])
  fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }))
  expect(screen.queryByAltText(/a\.png/)).not.toBeInTheDocument()
  expect(screen.getByAltText(/b\.png/)).toBeInTheDocument()
})

it("rejects other file types and caps the count at 5", () => {
  setup()
  pick([new File(["x"], "x.gif", { type: "image/gif" })])
  expect(screen.getByText(/Only PNG, JPEG or WebP/)).toBeInTheDocument()

  pick(["1", "2", "3", "4", "5", "6"].map((n) => png(`${n}.png`)))
  expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(5)
  expect(screen.getByText(/up to 5 screenshots/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Add screenshots/ })).toBeDisabled()
})
