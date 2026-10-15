"use client"

import { Button } from "@/components/ui"
import {
  describeFilters,
  hasActiveFilters,
  NO_FILTERS,
  SEVERITY_OPTIONS,
  type AlertFilterOptions,
  type AlertFilters,
} from "@/components/scenario/siemAlertQuery"

export const ALERT_FILTER_SELECT_CLASS =
  "text-xs bg-secondary border border-border rounded px-1.5 py-1 text-text-main max-w-[14rem] disabled:opacity-60"

export const ALERT_FILTER_INPUT_CLASS =
  "text-xs bg-secondary border border-border rounded px-1.5 py-1 text-text-main min-w-[10rem] max-w-[16rem]"

interface AlertFilterBarProps {
  filters: AlertFilters
  options: AlertFilterOptions
  totalCount: number
  visibleCount: number
  onChange: (next: AlertFilters) => void
  /** When true, rule dropdown is locked (e.g. student Rule 5710 shortcut). */
  ruleLocked?: boolean
  ruleLockedValue?: string
  ruleLockedLabel?: string
  summaryTestId?: string
}

/**
 * Shared rule / agent / severity / text filters for live SIEM and archived lab logs.
 */
export function AlertFilterBar({
  filters,
  options,
  totalCount,
  visibleCount,
  onChange,
  ruleLocked = false,
  ruleLockedValue = "5710",
  ruleLockedLabel = "Rule 5710 (shortcut on)",
  summaryTestId = "siem-filter-summary",
}: AlertFilterBarProps) {
  const active = hasActiveFilters(filters)
  const setFilter = <K extends keyof AlertFilters>(key: K, value: AlertFilters[K]) =>
    onChange({ ...filters, [key]: value })

  return (
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <label className="sr-only" htmlFor="alert-filter-query">
        Search alerts
      </label>
      <input
        id="alert-filter-query"
        type="search"
        aria-label="Search alerts"
        placeholder="Search rule, agent, text…"
        className={ALERT_FILTER_INPUT_CLASS}
        value={filters.query}
        onChange={(e) => setFilter("query", e.target.value)}
      />
      <select
        aria-label="Filter by rule"
        className={ALERT_FILTER_SELECT_CLASS}
        value={ruleLocked ? ruleLockedValue : filters.ruleId}
        disabled={ruleLocked}
        onChange={(e) => setFilter("ruleId", e.target.value)}
      >
        {ruleLocked ? (
          <option value={ruleLockedValue}>{ruleLockedLabel}</option>
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
        className={ALERT_FILTER_SELECT_CLASS}
        value={filters.agent}
        onChange={(e) => setFilter("agent", e.target.value)}
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
        className={ALERT_FILTER_SELECT_CLASS}
        value={filters.severity}
        onChange={(e) => setFilter("severity", e.target.value as AlertFilters["severity"])}
      >
        <option value="">All severities</option>
        {SEVERITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {active && (
        <>
          <span className="text-xs text-text-muted" data-testid={summaryTestId}>
            Showing {visibleCount} of {totalCount} · {describeFilters(filters)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </Button>
        </>
      )}
    </div>
  )
}
