'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { provisioning, type SiemAlert } from '@/lib/api'
import { Button } from '@/components/ui'
import { copyToClipboard } from '@/lib/copyToClipboard'
import { useToastContext } from '@/context/ToastContext'
import {
  alertsQuery,
  emptyAlertsCopy,
  formatAlertTime,
  groupAlertsByRule,
  SIEM_TABLE_CLASS,
  SIEM_TABLE_VIEWPORT_CLASS,
  SIEM_TD,
  SIEM_TH_CLASS,
} from '@/components/scenario/siemAlertQuery'

const POLL_MS = 30_000

function levelClass(level: number): string {
  if (level >= 7) return 'text-red-600'
  if (level >= 5) return 'text-yellow-600'
  return 'text-blue-600'
}

export function SiemAlertViewer({ podId }: { podId: number }) {
  const { success, warning } = useToastContext()
  const [alerts, setAlerts] = useState<SiemAlert[]>([])
  const [error, setError] = useState<'manager' | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [only5710, setOnly5710] = useState(false)
  const [rawEvents, setRawEvents] = useState(false)
  const [expandedRule, setExpandedRule] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await provisioning.getAlerts(podId, alertsQuery(only5710))
      if (data.error === 'manager_unavailable') {
        setError('manager')
        setAlerts([])
      } else {
        setError(null)
        setAlerts(data.alerts || [])
      }
      setFetchedAt(new Date())
    } catch {
      // 503 manager_unavailable or network/auth failure — student can still use templates
      setError('manager')
      setAlerts([])
      setFetchedAt(new Date())
    } finally {
      setLoading(false)
    }
  }, [podId, only5710])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const copyEvent = useCallback(
    async (timestamp: string, ruleId: string) => {
      const ok = await copyToClipboard(`${timestamp} ${ruleId}`)
      if (ok) success('Copied timestamp + rule id')
      else warning('Could not copy timestamp + rule id')
    },
    [success, warning]
  )

  if (error === 'manager') {
    return (
      <div className="text-sm">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Button size="sm" variant="secondary" onClick={() => load()} disabled={loading}>
            Refresh
          </Button>
          {fetchedAt && (
            <span className="text-xs text-text-muted">Updated {fetchedAt.toLocaleTimeString()}</span>
          )}
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
        {fetchedAt && (
          <span className="text-xs text-text-muted">Updated {fetchedAt.toLocaleTimeString()}</span>
        )}
      </div>
      <div className={SIEM_TABLE_VIEWPORT_CLASS}>
        {alerts.length === 0 ? (
          <p className="text-text-secondary p-2">{emptyAlertsCopy(only5710)}</p>
        ) : rawEvents ? (
          <EventTable
            rows={alerts}
            onCopy={copyEvent}
          />
        ) : (
          <GroupedTable
            groups={groupAlertsByRule(alerts)}
            expandedRule={expandedRule}
            onToggle={(ruleId) => setExpandedRule((cur) => (cur === ruleId ? null : ruleId))}
            onCopy={copyEvent}
          />
        )}
      </div>
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
