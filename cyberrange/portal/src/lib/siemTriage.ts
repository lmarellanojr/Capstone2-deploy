import type { SiemAlert } from "@/lib/api"

/**
 * Instructor-side triage for a lab's SIEM alerts.
 *
 * A fresh lab raises a couple of hundred alerts on its own: the Wazuh agent's
 * start-up Security Configuration Assessment (CIS benchmark checks, 19xxx) and
 * rootcheck scan (510) fire within a minute of the agents starting, whatever
 * the student does. This sorts alerts into what the instructor cares about
 * (the scenario's expected rule, then likely student activity) versus that
 * background, and groups repeats of one rule into a single row.
 *
 * Students never see this: Scenario 3 is an alert-triage exercise where
 * filtering the noise is the task, so the student panel stays raw.
 */

export type AlertCategory = "expected" | "activity" | "other" | "background"

/**
 * Rules each scenario is scored on, per scenario_id ("09").
 * MUST match the live-catalog entries of DETECTION_RULES in
 * src/provisioning/wazuh_rule_map.py (siemTriage.test.ts checks this).
 */
export const EXPECTED_RULES: Record<string, string[]> = {
  "09": ["5710"],
}

type Range = { from: number; to: number; label: string }

// Things a student's actions produce on meta/dvwa (default Wazuh ruleset ids).
const ACTIVITY: Range[] = [
  { from: 5700, to: 5799, label: "SSH login activity" },
  { from: 5400, to: 5409, label: "sudo / privilege use" },
  { from: 5503, to: 5599, label: "Login / authentication" },
  { from: 550, to: 554, label: "File changed (integrity monitoring)" },
  { from: 594, to: 598, label: "File changed (integrity monitoring)" },
  { from: 5900, to: 5999, label: "User or group changed" },
  { from: 31100, to: 31199, label: "Web attack" },
  { from: 31500, to: 31599, label: "Web attack" },
]

// Raised by the platform itself, not the student.
const BACKGROUND: Range[] = [
  { from: 19000, to: 19999, label: "Security configuration scan (CIS)" },
  { from: 500, to: 509, label: "Wazuh agent / manager status" },
  { from: 510, to: 549, label: "Rootcheck host scan" },
  { from: 2900, to: 2999, label: "Package manager (apt/dpkg)" },
  { from: 1000, to: 1099, label: "Wazuh internal" },
]

function inRanges(ranges: Range[], id: number): Range | undefined {
  return ranges.find((r) => id >= r.from && id <= r.to)
}

export function categorize(ruleId: string, scenarioId?: string | number | null): { category: AlertCategory; label: string } {
  const sid = scenarioId == null ? "" : String(scenarioId).padStart(2, "0")
  if (sid && EXPECTED_RULES[sid]?.includes(ruleId)) return { category: "expected", label: "Expected for this scenario" }
  const id = Number(ruleId)
  if (Number.isFinite(id)) {
    const act = inRanges(ACTIVITY, id)
    if (act) return { category: "activity", label: act.label }
    const bg = inRanges(BACKGROUND, id)
    if (bg) return { category: "background", label: bg.label }
  }
  return { category: "other", label: "Other" }
}

export interface TriageGroup {
  rule_id: string
  description: string
  category: AlertCategory
  label: string
  level: number
  count: number
  first: string
  last: string
  agents: string[]
  /** newest first */
  alerts: SiemAlert[]
}

export interface TriageResult {
  groups: TriageGroup[]
  counts: Record<AlertCategory, number>
}

const ORDER: Record<AlertCategory, number> = { expected: 0, activity: 1, other: 2, background: 3 }

/** Group by rule and categorize. Input may be in any order. */
export function triageAlerts(alerts: SiemAlert[], scenarioId?: string | number | null): TriageResult {
  const counts: Record<AlertCategory, number> = { expected: 0, activity: 0, other: 0, background: 0 }
  const byRule = new Map<string, TriageGroup>()
  for (const a of alerts) {
    const { category, label } = categorize(a.rule_id, scenarioId)
    counts[category] += 1
    let g = byRule.get(a.rule_id)
    if (!g) {
      g = {
        rule_id: a.rule_id,
        description: a.rule_description,
        category,
        label,
        level: a.rule_level,
        count: 0,
        first: a.timestamp,
        last: a.timestamp,
        agents: [],
        alerts: [],
      }
      byRule.set(a.rule_id, g)
    }
    g.count += 1
    g.level = Math.max(g.level, a.rule_level)
    if (a.timestamp < g.first) g.first = a.timestamp
    if (a.timestamp > g.last) g.last = a.timestamp
    if (!g.agents.includes(a.agent_name)) g.agents.push(a.agent_name)
    g.alerts.push(a)
  }
  const groups = Array.from(byRule.values())
  for (const g of groups) g.alerts.sort((x, y) => y.timestamp.localeCompare(x.timestamp))
  groups.sort((x, y) => ORDER[x.category] - ORDER[y.category] || y.count - x.count || y.level - x.level)
  return { groups, counts }
}
