/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { KnowledgeGainExport } from "./KnowledgeGainExport"
import { instructor } from "@/lib/api"

jest.mock("@/lib/api", () => ({
  instructor: { exportKnowledgeGain: jest.fn() },
}))

const exportKnowledgeGain = instructor.exportKnowledgeGain as jest.Mock

beforeEach(() => {
  exportKnowledgeGain.mockReset()
  exportKnowledgeGain.mockResolvedValue(new Blob(["student_id\n"], { type: "text/csv" }))
  Object.assign(URL, { createObjectURL: jest.fn(() => "blob:x"), revokeObjectURL: jest.fn() })
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

it("instructor card has no anonymize toggle and always requests anonymized data (#271)", async () => {
  render(<KnowledgeGainExport />)
  expect(screen.queryByLabelText("Anonymize student IDs")).not.toBeInTheDocument()
  expect(screen.getByText("Student IDs are anonymized. Identified exports are admin-only.")).toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: /Download/ }))
  await waitFor(() => expect(exportKnowledgeGain).toHaveBeenCalled())
  expect(exportKnowledgeGain.mock.calls[0][0]).toMatchObject({ format: "csv", anonymize: true })
  expect(await screen.findByRole("status")).toHaveTextContent("knowledge_gain_anonymized.csv")
})

it("admin card can turn anonymization off and warns about personal data", async () => {
  render(<KnowledgeGainExport allowIdentified />)
  const toggle = screen.getByLabelText("Anonymize student IDs")
  expect(toggle).toBeChecked()
  expect(screen.queryByText(/Identified exports are admin-only/)).not.toBeInTheDocument()

  fireEvent.click(toggle)
  expect(screen.getByText(/real student usernames/)).toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: /Download/ }))
  await waitFor(() => expect(exportKnowledgeGain).toHaveBeenCalled())
  expect(exportKnowledgeGain.mock.calls[0][0]).toMatchObject({ anonymize: false })
  expect(await screen.findByRole("status")).toHaveTextContent("knowledge_gain_identified.csv")
})
