import {
  catalogMilestonePoints,
  earnedByScenario,
  earnedPointsForAttempt,
  progressStatus,
  recommendedScenarioId,
  scenarioTotalPoints,
} from "./scenarioProgress"

const S = [
  { id: "01", displayNumber: 1, milestones: [{ id: 1, points: 50 }, { id: 2, points: 50 }] },
  { id: "06", displayNumber: 2, milestones: [{ id: 1, points: 100 }] },
  { id: "09", displayNumber: 3, milestones: [{ id: 1, points: 75 }] },
]

describe("earnedByScenario", () => {
  it("counts each PASS milestone once and ignores FAIL and unknown milestones", () => {
    const rows = [
      { scenario_id: 1, milestone_id: 1, status: "PASS" },
      { scenario_id: 1, milestone_id: 1, status: "PASS" }, // duplicate PASS
      { scenario_id: 1, milestone_id: 2, status: "FAIL" },
      { scenario_id: 6, milestone_id: 1, status: "PASS" },
      { scenario_id: 6, milestone_id: 99, status: "PASS" }, // not in catalog
    ]
    expect(earnedByScenario(rows, S)).toEqual({ "01": 50, "06": 100 })
  })
})

describe("catalogMilestonePoints / earnedPointsForAttempt", () => {
  it("looks up catalog points and awards them only on PASS", () => {
    expect(catalogMilestonePoints(1, 1, S)).toBe(50)
    expect(catalogMilestonePoints("06", 1, S)).toBe(100)
    expect(catalogMilestonePoints(6, 99, S)).toBeNull()
    expect(earnedPointsForAttempt({ scenario_id: 6, milestone_id: 1, status: "PASS" }, S)).toBe(100)
    expect(earnedPointsForAttempt({ scenario_id: 6, milestone_id: 1, status: "FAIL" }, S)).toBe(0)
    expect(earnedPointsForAttempt({ scenario_id: 6, milestone_id: 99, status: "PASS" }, S)).toBeNull()
  })

  it("credits duplicate PASS rows only once when a seen set is shared", () => {
    const seen = new Set<string>()
    const rows = [
      { scenario_id: 6, milestone_id: 1, status: "PASS" },
      { scenario_id: 6, milestone_id: 1, status: "PASS" },
      { scenario_id: 1, milestone_id: 1, status: "PASS" },
    ]
    const col = rows.map((r) => earnedPointsForAttempt(r, S, seen))
    expect(col).toEqual([100, 0, 50])
    expect(col.reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(150)
  })
})

describe("progressStatus", () => {
  it.each([
    [0, 100, "not-started"],
    [50, 100, "in-progress"],
    [100, 100, "completed"],
  ] as const)("%i of %i is %s", (earned, total, want) => {
    expect(progressStatus(earned, total)).toBe(want)
  })
})

describe("recommendedScenarioId", () => {
  it("is the first lab in order that isn't completed", () => {
    expect(recommendedScenarioId(S, {})).toBe("01")
    expect(recommendedScenarioId(S, { "01": 50 })).toBe("01") // in progress still counts
    expect(recommendedScenarioId(S, { "01": 100 })).toBe("06")
  })

  it("is null while progress is loading or when every lab is done", () => {
    expect(recommendedScenarioId(S, null)).toBeNull()
    expect(recommendedScenarioId(S, { "01": 100, "06": 100, "09": 75 })).toBeNull()
  })

  it("follows catalog order, not array order", () => {
    expect(recommendedScenarioId([...S].reverse(), {})).toBe("01")
  })

  it("totals points", () => {
    expect(scenarioTotalPoints(S[0])).toBe(100)
  })
})
