import { describeSiemDetection } from "./siemDetection"

describe("SIEM detection labels", () => {
  it.each([1, 6, "06", 11])("shows absent catalog detection rules for %p", scenario => {
    expect(describeSiemDetection(scenario, 4, 0)).toBe("Not configured")
  })
  it("distinguishes configured SIEM triage from its other milestones", () => {
    expect(describeSiemDetection("09", 1, 0)).toBe("Not detected")
    expect(describeSiemDetection(9, 2, 0)).toBe("Not configured")
  })
  it.each([4, 8, 42, "invalid"])("does not assume unknown or legacy %p is unconfigured", scenario => {
    expect(describeSiemDetection(scenario, 1, 0)).toBe("Not detected")
  })
  it.each([1, 80])("preserves positive historical evidence (%p)", score => {
    expect(describeSiemDetection(6, 4, score)).toBe("Detected")
  })
  it.each([null, undefined, -1, NaN, Infinity])("does not invent a result for missing/invalid score %p", score => {
    expect(describeSiemDetection(6, 4, score)).toBe("Unknown")
  })
})
