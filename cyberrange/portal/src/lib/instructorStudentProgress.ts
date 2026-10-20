import type { InstructorMilestone } from "@/lib/api"
import { earnedByScenario, scenarioTotalPoints } from "@/lib/scenarioProgress"
import { formatScenarioNumber } from "@/lib/scenarioLabels"

/** Background poller non-PASS rows (FAIL, ERROR, UNKNOWN, ...) that flood instructor attempt history (#266). */
export function isBackgroundNonPass(m: {
  source?: string | null
  status: string
}): boolean {
  return m.source === "auto" && m.status !== "PASS"
}

/** Short label for the Source column; legacy null → em dash. */
export function verificationSourceLabel(source?: string | null): string {
  if (source == null || source === "") return "—"
  return source
}

export type ScenarioLike = {
  id: string
  displayNumber: number
  name: string
  milestones: { id: number; name: string; points: number }[]
}

export type MilestoneDetail = {
  milestoneId: number
  name: string
  points: number
  status: "PASS" | "FAIL" | "—"
  detectionScore: number | null
}

export type ScenarioProgressDetail = {
  scenarioId: string
  displayNumber: number
  label: string // "Scenario 1"
  name: string
  passed: number
  total: number
  pointsEarned: number
  pointsTotal: number
  milestones: MilestoneDetail[]
}

/**
 * Effective status per (scenario, milestone) for roster display.
 * Any PASS wins (matches student points); otherwise newest FAIL; detection
 * score comes from the winning PASS row or else the newest attempt.
 */
export function latestMilestoneStatuses(
  rows: InstructorMilestone[],
): Map<string, { status: string; detectionScore: number | null }> {
  type Acc = { status: string; detectionScore: number | null; at: string; hasPass: boolean }
  const out = new Map<string, Acc>()
  for (const row of rows) {
    const sid = String(row.scenario_id).padStart(2, "0")
    const key = `${sid}:${row.milestone_id}`
    const at = row.verified_at ?? ""
    const prev = out.get(key)
    if (!prev) {
      out.set(key, {
        status: row.status,
        detectionScore: row.detection_score ?? null,
        at,
        hasPass: row.status === "PASS",
      })
      continue
    }
    if (row.status === "PASS") {
      if (!prev.hasPass || at >= prev.at) {
        out.set(key, {
          status: "PASS",
          detectionScore: row.detection_score ?? null,
          at: at >= prev.at ? at : prev.at,
          hasPass: true,
        })
      }
      continue
    }
    if (!prev.hasPass && at >= prev.at) {
      out.set(key, {
        status: row.status,
        detectionScore: row.detection_score ?? null,
        at,
        hasPass: false,
      })
    }
  }
  // Array.from avoids TS2802 (MapIterator + default ES5 target / no downlevelIteration).
  return new Map(
    Array.from(out, ([k, v]) => [k, { status: v.status, detectionScore: v.detectionScore }]),
  )
}

/** Catalog scenario progress for every portal lab (includes untouched with empty statuses). */
export function scenarioProgressDetails(
  rows: InstructorMilestone[],
  scenarios: ScenarioLike[],
): ScenarioProgressDetail[] {
  const earned = earnedByScenario(rows, scenarios)
  const latest = latestMilestoneStatuses(rows)
  const ordered = [...scenarios].sort((a, b) => a.displayNumber - b.displayNumber)

  return ordered.map((s) => {
    const milestones: MilestoneDetail[] = s.milestones.map((m) => {
      const hit = latest.get(`${s.id}:${m.id}`)
      const status =
        hit?.status === "PASS" ? "PASS" : hit?.status === "FAIL" ? "FAIL" : "—"
      return {
        milestoneId: m.id,
        name: m.name,
        points: m.points,
        status,
        detectionScore: hit?.detectionScore ?? null,
      }
    })
    const passed = milestones.filter((m) => m.status === "PASS").length
    const pointsEarned = earned[s.id] ?? 0
    const pointsTotal = scenarioTotalPoints(s)
    return {
      scenarioId: s.id,
      displayNumber: s.displayNumber,
      label: formatScenarioNumber(Number(s.id)),
      name: s.name,
      passed,
      total: milestones.length,
      pointsEarned,
      pointsTotal,
      milestones,
    }
  })
}

/** Compact chips for the roster table: only scenarios the student has touched. */
export function touchedScenarioSummaries(
  rows: InstructorMilestone[],
  scenarios: ScenarioLike[],
): ScenarioProgressDetail[] {
  const touched = new Set(rows.map((r) => String(r.scenario_id).padStart(2, "0")))
  return scenarioProgressDetails(rows, scenarios).filter((d) => touched.has(d.scenarioId))
}

function catalogKeys(scenarios: ScenarioLike[]): Set<string> {
  const keys = new Set<string>()
  for (const s of scenarios) {
    for (const m of s.milestones) keys.add(`${s.id}:${m.id}`)
  }
  return keys
}

/** Distinct passed/attempted counts, limited to portal-catalog milestones. */
export function overallPassedAttempted(
  rows: InstructorMilestone[],
  scenarios: ScenarioLike[],
): {
  passed: number
  attempted: number
} {
  const catalog = catalogKeys(scenarios)
  const attempted = new Set<string>()
  const passed = new Set<string>()
  for (const m of rows) {
    const key = `${String(m.scenario_id).padStart(2, "0")}:${m.milestone_id}`
    if (!catalog.has(key)) continue
    attempted.add(key)
    if (m.status === "PASS") passed.add(key)
  }
  return { passed: passed.size, attempted: attempted.size }
}

export function totalPointsEarned(rows: InstructorMilestone[], scenarios: ScenarioLike[]): number {
  return Object.values(earnedByScenario(rows, scenarios)).reduce((a, b) => a + b, 0)
}
