import { formatScenarioName, formatScenarioNumber } from "./scenarioLabels"

describe("scenario labels use the 1-4 numbering, not internal ids", () => {
  it.each([
    [1, "Scenario 1"],
    [6, "Scenario 2"],
    ["9", "Scenario 3"],
    [11, "Scenario 4"],
  ])("formatScenarioNumber(%p) is %p", (id, expected) => {
    expect(formatScenarioNumber(id)).toBe(expected)
  })

  it("falls back for unknown or missing ids", () => {
    expect(formatScenarioNumber(42)).toBe("Scenario 42")
    expect(formatScenarioNumber(null)).toBe("—")
    expect(formatScenarioNumber(undefined)).toBe("—")
  })

  it("agrees with the full label", () => {
    expect(formatScenarioName(9).startsWith(formatScenarioNumber(9) + ":")).toBe(true)
  })
})
