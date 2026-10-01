'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { instructor, provisioning, type SiemAlert } from '@/lib/api'
import { Button } from '@/components/ui'
import { copyToClipboard } from '@/lib/copyToClipboard'
import { useToastContext } from '@/context/ToastContext'
import {
  alertsQuery,
  describeFilters,
  emptyAlertsCopy,
  filterAlerts,
  filteredEmptyCopy,
  filterOptions,
  formatAlertTime,
  groupAlertsByRule,
  hasActiveFilters,
  NO_FILTERS,
  POLL_MS,
  SEVERITY_OPTIONS,
  severityBand,
  SIEM_TABLE_CLASS,
  SIEM_TABLE_VIEWPORT_CLASS,
  SIEM_TD,
  SIEM_TH_CLASS,
  type AlertFilters,
  type SeverityBand,
} from '@/components/scenario/siemAlertQuery'

const SEVERITY_CLASS: Record<SeverityBand, string> = {
  high: 'text-red-600',
  medium: 'text-yellow-600',
  low: 'text-blue-600',
}

function levelClass(level: number): string {
  return SEVERITY_CLASS[severityBand(level)]
}

const FILTER_SELECT_CLASS =
  'text-xs bg-secondary border border-border rounded px-1.5 py-1 text-text-main max-w-[14rem] disabled:opacity-60'

function isTabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function SiemAlertViewer({
  podId,
  source = 'student',
}: {
  podId: number
  /** 'staff' reads the Instructor/Admin route (any student's pod, same safe fields). */
  source?: 'student' | 'staff'
}) {
  const { success, warning } = useToastContext()
  const [alerts, setAlerts] = useState<SiemAlert[]>([])
  const [error, setError] = useState<'manager' | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [only5710, setOnly5710] = useState(false)
  const [rawEvents, setRawEvents] = useState(false)
  const [expandedRule, setExpandedRule] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<AlertFilters>(NO_FILTERS)
  const [paused, setPaused] = useState(false)

  // Latest request wins: a filter/pod change mid-fetch must not be overwritten by the
  // older response. Interval ticks skip while a request is still in flight.
  const reqSeq = useRef(0)
  const inFlight = useRef(false)
  const lastFetchMs = useRef(0)

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    inFlight.current = true
    setLoading(true)
    try {
      const fetchAlerts = source === 'staff' ? instructor.getPodAlerts : provisioning.getAlerts
      const data = await fetchAlerts(podId, alertsQuery(only5710))
      if (seq !== reqSeq.current) return
      if (data.error === 'manager_unavailable') {
        setError('manager')
        setAlerts([])
      } else {
        setError(null)
        setAlerts(data.alerts || [])
      }
    } catch {
      if (seq !== reqSeq.current) return
      // 503 manager_unavailable or network/auth failure — student can still use templates
      setError('manager')
      setAlerts([])
    } finally {
      if (seq === reqSeq.current) {
        lastFetchMs.current = Date.now()
        setFetchedAt(new Date())
        inFlight.current = false
        setLoading(false)
      }
    }
  }, [podId, only5710, source])

  useEffect(() => {
    load()
    const t = setInterval(() => {
      if (isTabHidden() || inFlight.current) return
      load()
    }, POLL_MS)
    const onVisibility = () => {
      const hidden = isTabHidden()
      setPaused(hidden)
      // Catch up once on return instead of waiting up to a full interval.
      if (!hidden && !inFlight.current && Date.now() - lastFetchMs.current >= POLL_MS) load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  // The 5710 shortcut is applied server-side, so the rule dropdown is moot while it is on.
  const effectiveFilters = useMemo(
    () => (only5710 ? { ...filters, ruleId: '' } : filters),
    [filters, only5710]
  )
  const visible = useMemo(() => filterAlerts(alerts, effectiveFilters), [alerts, effectiveFilters])
  const options = useMemo(() => filterOptions(alerts, effectiveFilters), [alerts, effectiveFilters])
  const filtersActive = hasActiveFilters(effectiveFilters)

  const setFilter = <K extends keyof AlertFilters>(key: K, value: AlertFilters[K]) =>
    setFilters((cur) => ({ ...cur, [key]: value }))

  const copyEvent = useCallback(
    async (timestamp: string, ruleId: string) => {
      const ok = await copyToClipboard(`${timestamp} ${ruleId}`)
      if (ok) success('Copied timestamp + rule id')
      else warning('Could not copy timestamp + rule id')
    },
    [success, warning]
  )

  const status = fetchedAt && (
    <span className="text-xs text-text-muted" data-testid="siem-status">
      Updated {fetchedAt.toLocaleTimeString()} ·{' '}
      {paused ? 'auto-refresh paused (tab hidden)' : `auto-refresh every ${POLL_MS / 1000}s`}
    </span>
  )

  if (error === 'manager') {
    return (
      <div className="text-sm">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Button size="sm" variant="secondary" onClick={() => load()} disabled={loading}>
            Refresh
          </Button>
          {status}
        </div>
        <p className="text-text-secondary">
          Manager unavailable. Continue using the template files on meta; scoring accepts them.
        </p>
      </div>
    )
  }

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Button size="sm" variant="secondary" onClick={() => load()} disabled={loading}>
          Refresh
        </Button>
        <label className="text-xs text-text-muted inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={only5710}
            onChange={(e) => setOnly5710(e.target.checked)}
          />
          Rule 5710 only
        </label>
        <label className="text-xs text-text-muted inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={rawEvents}
            onChange={(e) => setRawEvents(e.target.checked)}
          />
          Raw events
        </label>
        {status}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <select
          aria-label="Filter by rule"
          className={FILTER_SELECT_CLASS}
          value={only5710 ? '5710' : filters.ruleId}
          disabled={only5710}
          onChange={(e) => setFilter('ruleId', e.target.value)}
        >
          {only5710 ? (
            <option value="5710">Rule 5710 (shortcut on)</option>
          ) : (
            <>
              <option value="">All rules</option>
              {options.rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.description ? `${r.id} — ${r.description}` : r.id}
                </option>
              ))}
            </>
          )}
        </select>
        <select
          aria-label="Filter by agent"
          className={FILTER_SELECT_CLASS}
          value={filters.agent}
          onChange={(e) => setFilter('agent', e.target.value)}
        >
          <option value="">All agents</option>
          {options.agents.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by severity"
          className={FILTER_SELECT_CLASS}
          value={filters.severity}
          onChange={(e) => setFilter('severity', e.target.value as AlertFilters['severity'])}
        >
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {filtersActive && (
          <>
            <span className="text-xs text-text-muted" data-testid="siem-filter-summary">
              Showing {visible.length} of {alerts.length} · {describeFilters(effectiveFilters)}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          </>
        )}
      </div>
      <div className={SIEM_TABLE_VIEWPORT_CLASS}>
        {alerts.length === 0 ? (
          <p className="text-text-secondary p-2">{emptyAlertsCopy(only5710)}</p>
        ) : visible.length === 0 ? (
          <p className="text-text-secondary p-2">
            {filteredEmptyCopy(effectiveFilters, alerts.length)}
          </p>
        ) : rawEvents ? (
          <EventTable
            rows={visible}
            onCopy={copyEvent}
          />
        ) : (
          <GroupedTable
            groups={groupAlertsByRule(visible)}
            expandedRule={expandedRule}
            onToggle={(ruleId) => setExpandedRule((cur) => (cur === ruleId ? null : ruleId))}
            onCopy={copyEvent}
          />
        )}
      </div>
      <p className="text-xs text-text-muted mt-1">
        Manager-only mode: alerts are read from the Wazuh manager&apos;s alert log. The Wazuh
        Indexer and Dashboard are not deployed on the 12 GiB host profile.
      </p>
    </div>
  )
}

function EventTable({
  rows,
  onCopy,
}: {
  rows: SiemAlert[]
  onCopy: (timestamp: string, ruleId: string) => void
}) {
  return (
    <table className={SIEM_TABLE_CLASS}>
      <thead className="sticky top-0 bg-secondary">
        <tr>
          <th className={SIEM_TH_CLASS}>Time</th>
          <th className={SIEM_TH_CLASS}>Rule</th>
          <th className={SIEM_TH_CLASS}>Agent</th>
          <th className={SIEM_TH_CLASS}>Lvl</th>
          <th className={SIEM_TH_CLASS}>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a, i) => (
          <tr
            key={`${a.timestamp}-${a.rule_id}-${i}`}
            className="cursor-pointer hover:bg-muted"
            onClick={() => onCopy(a.timestamp, a.rule_id)}
            title="Copy timestamp + rule id"
          >
            <AlertCells alert={a} />
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function GroupedTable({
  groups,
  expandedRule,
  onToggle,
  onCopy,
}: {
  groups: ReturnType<typeof groupAlertsByRule>
  expandedRule: string | null
  onToggle: (ruleId: string) => void
  onCopy: (timestamp: string, ruleId: string) => void
}) {
  return (
    <table className={SIEM_TABLE_CLASS}>
      <thead className="sticky top-0 bg-secondary">
        <tr>
          <th className={SIEM_TH_CLASS}>Count</th>
          <th className={SIEM_TH_CLASS}>Last seen</th>
          <th className={SIEM_TH_CLASS}>Rule</th>
          <th className={SIEM_TH_CLASS}>Agent</th>
          <th className={SIEM_TH_CLASS}>Lvl</th>
          <th className={SIEM_TH_CLASS}>Description</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.rule_id}>
            <tr
              className="cursor-pointer hover:bg-muted"
              onClick={() => onToggle(g.rule_id)}
              title="Expand events for this rule"
            >
              <td className={`${SIEM_TD.level} tabular-nums`}>{g.count}</td>
              <td className={SIEM_TD.time}>{formatAlertTime(g.last_timestamp)}</td>
              <td className={SIEM_TD.rule}>{g.rule_id}</td>
              <td className={SIEM_TD.agent} title={g.agent_name}>
                {g.agent_name}
              </td>
              <td className={`${SIEM_TD.level} ${levelClass(g.rule_level)}`}>{g.rule_level}</td>
              <td className={SIEM_TD.desc} title={g.rule_description}>
                {g.rule_description}
              </td>
            </tr>
            {expandedRule === g.rule_id &&
              g.events.map((a, i) => (
                <tr
                  key={`${a.timestamp}-${a.rule_id}-${i}`}
                  className="cursor-pointer hover:bg-muted bg-muted/40"
                  onClick={() => onCopy(a.timestamp, a.rule_id)}
                  title="Copy timestamp + rule id"
                >
                  <td className={SIEM_TD.level} />
                  <AlertCells alert={a} />
                </tr>
              ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

function AlertCells({ alert }: { alert: SiemAlert }) {
  return (
    <>
      <td className={SIEM_TD.time}>{formatAlertTime(alert.timestamp)}</td>
      <td className={SIEM_TD.rule}>{alert.rule_id}</td>
      <td className={SIEM_TD.agent} title={alert.agent_name}>
        {alert.agent_name}
      </td>
      <td className={`${SIEM_TD.level} ${levelClass(alert.rule_level)}`}>{alert.rule_level}</td>
      <td className={SIEM_TD.desc} title={alert.rule_description}>
        {alert.rule_description}
      </td>
    </>
  )
}
