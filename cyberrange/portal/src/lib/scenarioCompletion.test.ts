import {
  isScenarioComplete,
  normalizeScenarioId,
  passedMilestoneIdsForScenario,
  scenarioProgressKey,
} from "./scenarioCompletion"
import { SCENARIOS } from "@/hooks/useScenarios"

const scenario11MilestoneIds = SCENARIOS.find((scenario) => scenario.id === "11")!
  .milestones.map((milestone) => milestone.id)

describe("scenarioCompletion", () => {
  it("keeps Scenario 11 configured with M1, M2, and M3 as required milestones", () => {
    expect(scenario11MilestoneIds).toEqual([1, 2, 3])
  })

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
      requiredMilestoneIds: scenario11MilestoneIds,
      completedMilestoneIds: new Set([2]),
      currentProgressKey,
      loadedProgressKey: currentProgressKey,
    })).toBe(false)
    expect(isScenarioComplete({
      scenarioId: "11",
      requiredMilestoneIds: scenario11MilestoneIds,
      completedMilestoneIds: new Set(scenario11MilestoneIds),
      currentProgressKey,
      loadedProgressKey: scenarioProgressKey(6, "01"),
    })).toBe(false)
  })

  it("does not mark a scenario complete when no milestones are required", () => {
    const key = scenarioProgressKey(7, "11")
    expect(isScenarioComplete({
      scenarioId: "11",
      requiredMilestoneIds: [],
      completedMilestoneIds: new Set([1, 2, 3]),
      currentProgressKey: key,
      loadedProgressKey: key,
    })).toBe(false)
  })

  it("completes Scenario 11 only with its own loaded M1, M2, and M3", () => {
    const key = scenarioProgressKey(7, 11)
    expect(isScenarioComplete({
      scenarioId: 11,
      requiredMilestoneIds: scenario11MilestoneIds,
      completedMilestoneIds: new Set(scenario11MilestoneIds),
      currentProgressKey: key,
      loadedProgressKey: key,
    })).toBe(true)
  })
})
