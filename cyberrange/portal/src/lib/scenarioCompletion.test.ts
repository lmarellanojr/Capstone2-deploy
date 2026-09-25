import {
  isScenarioComplete,
  normalizeScenarioId,
  passedMilestoneIdsForScenario,
  scenarioProgressKey,
} from "./scenarioCompletion"

describe("scenarioCompletion", () => {
  it("normalizes numeric and zero-padded ids but rejects malformed coercions", () => {
    expect(normalizeScenarioId(11)).toBe("11")
    expect(normalizeScenarioId("11")).toBe("11")
    expect(normalizeScenarioId("01")).toBe("1")
    expect(normalizeScenarioId(11.5)).toBeNull()
    expect(normalizeScenarioId(Number.NaN)).toBeNull()
    expect(normalizeScenarioId("")).toBeNull()
    expect(normalizeScenarioId(" 11 ")).toBeNull()
    expect(normalizeScenarioId("11x")).toBeNull()
  })

  it("selects only PASS rows belonging to the active scenario", () => {
    const passed = passedMilestoneIdsForScenario([
      { scenario_id: 1, milestone_id: 1, status: "PASS" },
      { scenario_id: "11", milestone_id: 2, status: "PASS" },
      { scenario_id: 11, milestone_id: 3, status: "FAIL" },
      { scenario_id: " 11 ", milestone_id: 1, status: "PASS" },
    ], "11")
    expect(Array.from(passed)).toEqual([2])
  })

  it("keeps Scenario 11 incomplete for M2-only or a stale progress key", () => {
    const currentProgressKey = scenarioProgressKey(7, "11")
    expect(isScenarioComplete({
      scenarioId: "11",
      requiredMilestoneIds: [1, 2, 3],
      completedMilestoneIds: new Set([2]),
      currentProgressKey,
      loadedProgressKey: currentProgressKey,
    })).toBe(false)
    expect(isScenarioComplete({
      scenarioId: "11",
      requiredMilestoneIds: [1, 2, 3],
      completedMilestoneIds: new Set([1, 2, 3]),
      currentProgressKey,
      loadedProgressKey: scenarioProgressKey(6, "01"),
    })).toBe(false)
  })

  it("completes Scenario 11 only with its own loaded M1, M2, and M3", () => {
    const key = scenarioProgressKey(7, 11)
    expect(isScenarioComplete({
      scenarioId: 11,
      requiredMilestoneIds: [1, 2, 3],
      completedMilestoneIds: new Set([1, 2, 3]),
      currentProgressKey: key,
      loadedProgressKey: key,
    })).toBe(true)
  })
})
