/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { render } from "@testing-library/react"
import { CyberQuote, quoteFor } from "./CyberQuote"

it("keeps the same quote across re-renders (no per-tick change)", () => {
  const { rerender } = render(<CyberQuote scenarioId="11" />)
  const text = document.querySelector("blockquote")?.textContent
  for (let i = 0; i < 5; i++) rerender(<CyberQuote scenarioId="11" />)
  expect(text).toContain("Security is a process")
  expect(document.querySelector("blockquote")?.textContent).toBe(text)
})

it("gives each scenario its own quote", () => {
  const texts = ["01", "06", "09", "11"].map((id) => quoteFor(id).text)
  expect(new Set(texts).size).toBe(4)
})

it("falls back for an unknown scenario", () => {
  expect(quoteFor("99").text).toMatch(/beginner/)
})
