export interface MilestoneStatus {
  scenario_id: number | string
  milestone_id: number
  status: string
}

export function normalizeScenarioId(value: number | string): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (!/^[0-9]+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null
}

export function scenarioProgressKey(podId: number, scenarioId: number | string): string | null {
  if (!Number.isSafeInteger(podId) || podId <= 0) return null
  const normalized = normalizeScenarioId(scenarioId)
  return normalized === null ? null : `${podId}:${normalized}`
}

export function passedMilestoneIdsForScenario(
  milestones: MilestoneStatus[],
  scenarioId: number | string
): Set<number> {
  const expected = normalizeScenarioId(scenarioId)
  if (expected === null) return new Set()
  return new Set(
    milestones
      .filter((milestone) =>
        milestone.status === "PASS" && normalizeScenarioId(milestone.scenario_id) === expected
      )
      .map((milestone) => milestone.milestone_id)
  )
}

export function isScenarioComplete(options: {
  scenarioId: number | string
  requiredMilestoneIds: number[]
  completedMilestoneIds: Set<number>
  currentProgressKey: string | null
  loadedProgressKey: string | null
}): boolean {
  const {
    scenarioId,
    requiredMilestoneIds,
    completedMilestoneIds,
    currentProgressKey,
    loadedProgressKey,
  } = options
  if (currentProgressKey === null || loadedProgressKey !== currentProgressKey) return false
  if (normalizeScenarioId(scenarioId) === null) return false
  if (requiredMilestoneIds.length === 0) return false
  if (!requiredMilestoneIds.every((id) => completedMilestoneIds.has(id))) return false
  return true
}
