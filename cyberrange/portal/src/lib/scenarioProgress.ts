// Per-scenario progress for the student catalog and dashboard: points earned
// from GET /progress, reduced to a status a student can read at a glance.

export type ProgressStatus = "not-started" | "in-progress" | "completed"

interface ScenarioLike {
  id: string
  displayNumber: number
  milestones: { id: number; points: number }[]
}

interface ProgressRow {
  scenario_id: number | string
  milestone_id: number
  status: string
}

export function scenarioTotalPoints(s: ScenarioLike): number {
  return s.milestones.reduce((sum, m) => sum + m.points, 0)
}

/** Catalog points for one milestone id, or null when that task is not in the portal catalog. */
export function catalogMilestonePoints(
  scenarioId: number | string,
  milestoneId: number,
  scenarios: ScenarioLike[],
): number | null {
  const sid = String(scenarioId).padStart(2, "0")
  const m = scenarios.find((s) => s.id === sid)?.milestones.find((x) => x.id === milestoneId)
  return m ? m.points : null
}

function attemptKey(row: ProgressRow): string {
  return `${String(row.scenario_id).padStart(2, "0")}:${row.milestone_id}`
}

/**
 * Points shown on one attempt row.
 * - `null` = milestone not in the portal catalog (render as —)
 * - `0` = not PASS, or a later duplicate PASS for a milestone already credited
 * - `>0` = first PASS for that catalog milestone
 *
 * Pass the same `seen` Set while mapping a list so the column sums to
 * `earnedByScenario` / student-dashboard totals.
 */
export function earnedPointsForAttempt(
  row: ProgressRow,
  scenarios: ScenarioLike[],
  seen?: Set<string>,
): number | null {
  const catalogPts = catalogMilestonePoints(row.scenario_id, row.milestone_id, scenarios)
  if (catalogPts == null) return null
  if (row.status !== "PASS") return 0
  if (seen) {
    const key = attemptKey(row)
    if (seen.has(key)) return 0
    seen.add(key)
  }
  return catalogPts
}

/** Points earned per catalog id ("01", "06", ...). Each milestone counts once,
 *  however many PASS rows it has, and only for milestones in the catalog. */
export function earnedByScenario(rows: ProgressRow[], scenarios: ScenarioLike[]): Record<string, number> {
  const seen = new Set<string>()
  const out: Record<string, number> = {}
  for (const row of rows) {
    if (row.status !== "PASS") continue
    const sid = String(row.scenario_id).padStart(2, "0")
    const key = `${sid}:${row.milestone_id}`
    if (seen.has(key)) continue
    seen.add(key)
    const m = scenarios.find((s) => s.id === sid)?.milestones.find((x) => x.id === row.milestone_id)
    if (m) out[sid] = (out[sid] ?? 0) + m.points
  }
  return out
}

export function progressStatus(earned: number, total: number): ProgressStatus {
  if (earned <= 0) return "not-started"
  return earned >= total ? "completed" : "in-progress"
}

/** The lab a student should do next: the first one, in catalog order, that
 *  isn't completed. null while progress is unknown or when everything is done. */
export function recommendedScenarioId(
  scenarios: ScenarioLike[],
  earned: Record<string, number> | null
): string | null {
  if (earned === null) return null
  const ordered = [...scenarios].sort((a, b) => a.displayNumber - b.displayNumber)
  const next = ordered.find((s) => progressStatus(earned[s.id] ?? 0, scenarioTotalPoints(s)) !== "completed")
  return next ? next.id : null
}
