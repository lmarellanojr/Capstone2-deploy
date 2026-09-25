/** Scenario 09 Open SIEM view-model: fetch query, group-by-rule, table layout tokens. */
import type { SiemAlert } from '@/lib/api'

export const ALERTS_LIMIT = 200

/**
 * Auto-refresh cadence. Wazuh runs manager-only on the 12 GiB host (no Indexer/Dashboard),
 * so each poll tails the manager's alerts.json via GET /pods/{id}/alerts. 15s keeps new
 * events within one interval of the student's action while bounding that file read to
 * 4/min per open pane; polling is skipped while the tab is hidden.
 */
export const POLL_MS = 15_000

export type SiemAlertGroup = {
  rule_id: string
  count: number
  last_timestamp: string
  agent_name: string
  rule_level: number
  rule_description: string
  events: SiemAlert[]
}

export function groupAlertsByRule(alerts: SiemAlert[]): SiemAlertGroup[] {
  const map = new Map<string, SiemAlertGroup>()
  for (const a of alerts) {
    const existing = map.get(a.rule_id)
    if (!existing) {
      map.set(a.rule_id, {
        rule_id: a.rule_id,
        count: 1,
        last_timestamp: a.timestamp,
        agent_name: a.agent_name,
        rule_level: a.rule_level,
        rule_description: a.rule_description,
        events: [a],
      })
      continue
    }
    existing.count += 1
    existing.events.push(a)
    if (a.timestamp > existing.last_timestamp) {
      existing.last_timestamp = a.timestamp
      existing.agent_name = a.agent_name
      existing.rule_level = a.rule_level
      existing.rule_description = a.rule_description
    }
  }
  const groups = Array.from(map.values())
  for (const g of groups) {
    g.events.sort((x, y) => (x.timestamp < y.timestamp ? 1 : -1))
  }
  return groups.sort((a, b) => (a.last_timestamp < b.last_timestamp ? 1 : -1))
}

/** Reserved pane: table scrolls inside this box so the Kali CLI does not jump up. */
export const SIEM_TABLE_VIEWPORT_CLASS =
  'min-h-48 max-h-80 overflow-y-auto overflow-x-auto border border-border'

/** Content-sized table: Time/Rule/Agent/Lvl shrink; description wraps in the leftover width. */
export const SIEM_TABLE_CLASS = 'w-max min-w-full text-xs border-collapse'

export const SIEM_TH_CLASS = 'px-2 py-1.5 text-left whitespace-nowrap font-medium'

export const SIEM_TD = {
  time: 'px-2 py-1.5 whitespace-nowrap w-px',
  rule: 'px-2 py-1.5 font-mono whitespace-nowrap w-px',
  agent: 'px-2 py-1.5 font-mono whitespace-nowrap w-px',
  level: 'px-2 py-1.5 whitespace-nowrap w-px tabular-nums',
  desc: 'px-2 py-1.5 whitespace-normal min-w-[12rem]',
}

export function formatAlertTime(timestamp: string): string {
  const normalized = timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const d = new Date(normalized)
  return Number.isNaN(d.getTime())
    ? timestamp
    : d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
}

export function alertsQuery(only5710: boolean): { limit: number; rule_id?: string } {
  if (only5710) return { limit: ALERTS_LIMIT, rule_id: '5710' }
  return { limit: ALERTS_LIMIT }
}

export function emptyAlertsCopy(only5710: boolean): string {
  if (only5710) {
    return 'No rule 5710 in the last query window. CIS/SCA rows are hidden by this filter. Run Task 0 SSH from Kali; the table refreshes every 15s.'
  }
  return 'No alerts yet. Running Task 0 on Kali? Alerts usually appear 1–2 minutes after SSH/nmap commands; the table refreshes every 15s. See the guide.'
}

/** Severity bands match the Lvl column colours (red / yellow / blue). */
export type SeverityBand = 'high' | 'medium' | 'low'

export const SEVERITY_OPTIONS: { value: SeverityBand; label: string }[] = [
  { value: 'high', label: 'High (7+)' },
  { value: 'medium', label: 'Medium (5–6)' },
  { value: 'low', label: 'Low (0–4)' },
]

export function severityBand(level: number): SeverityBand {
  if (level >= 7) return 'high'
  if (level >= 5) return 'medium'
  return 'low'
}

/** Client-side filter dimensions over the fetched rows. Empty string = All. */
export type AlertFilters = {
  ruleId: string
  agent: string
  severity: SeverityBand | ''
}

export const NO_FILTERS: AlertFilters = { ruleId: '', agent: '', severity: '' }

export function hasActiveFilters(f: AlertFilters): boolean {
  return f.ruleId !== '' || f.agent !== '' || f.severity !== ''
}

export function filterAlerts(alerts: SiemAlert[], f: AlertFilters): SiemAlert[] {
  if (!hasActiveFilters(f)) return alerts
  return alerts.filter(
    (a) =>
      (f.ruleId === '' || a.rule_id === f.ruleId) &&
      (f.agent === '' || a.agent_name === f.agent) &&
      (f.severity === '' || severityBand(a.rule_level) === f.severity)
  )
}

export type AlertFilterOptions = {
  rules: { id: string; description: string }[]
  agents: string[]
}

/**
 * Distinct rule IDs / agents in the fetched rows. A selected value that has aged out of
 * the query window is kept so the dropdown never silently snaps back to All.
 */
export function filterOptions(alerts: SiemAlert[], f: AlertFilters): AlertFilterOptions {
  const rules = new Map<string, string>()
  const agents = new Set<string>()
  for (const a of alerts) {
    if (a.rule_id && !rules.has(a.rule_id)) rules.set(a.rule_id, a.rule_description)
    if (a.agent_name) agents.add(a.agent_name)
  }
  if (f.ruleId && !rules.has(f.ruleId)) rules.set(f.ruleId, '')
  if (f.agent) agents.add(f.agent)
  return {
    rules: Array.from(rules, ([id, description]) => ({ id, description })).sort((x, y) =>
      x.id.localeCompare(y.id, undefined, { numeric: true })
    ),
    agents: Array.from(agents).sort(),
  }
}

export function describeFilters(f: AlertFilters): string {
  const parts: string[] = []
  if (f.ruleId) parts.push(`rule ${f.ruleId}`)
  if (f.agent) parts.push(`agent ${f.agent}`)
  if (f.severity) {
    const label = SEVERITY_OPTIONS.find((o) => o.value === f.severity)?.label ?? f.severity
    parts.push(`severity ${label}`)
  }
  return parts.join(', ')
}

/** Empty state when rows were fetched but the active filters hide all of them. */
export function filteredEmptyCopy(f: AlertFilters, hidden: number): string {
  const noun = hidden === 1 ? 'alert' : 'alerts'
  return `No alerts match ${describeFilters(f)}. ${hidden} ${noun} hidden by filters.`
}
