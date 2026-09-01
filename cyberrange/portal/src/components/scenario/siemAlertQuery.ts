/** Scenario 09 Open SIEM view-model: fetch query, group-by-rule, table layout tokens. */
import type { SiemAlert } from '@/lib/api'

export const ALERTS_LIMIT = 200

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
    return 'No rule 5710 in the last query window. CIS/SCA rows are hidden by this filter. Run Task 0 SSH from Kali, then Refresh.'
  }
  return 'No alerts yet. Running Task 0 on Kali? Refresh in 1–2 minutes after SSH/nmap commands. See the guide.'
}
