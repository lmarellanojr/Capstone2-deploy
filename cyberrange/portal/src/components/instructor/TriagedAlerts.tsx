"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SiemAlert } from "@/lib/api";
import { triageAlerts, type AlertCategory } from "@/lib/siemTriage";
import { formatAlertTime, severityBand, SIEM_TD, SIEM_TH_CLASS, type SeverityBand } from "@/components/scenario/siemAlertQuery";
import { AlertHistoryTable } from "./AlertHistoryTable";

const SEVERITY_CLASS: Record<SeverityBand, string> = {
  high: "text-red-600",
  medium: "text-yellow-600",
  low: "text-blue-600",
};

const CATEGORY_STYLE: Record<AlertCategory, string> = {
  expected: "bg-green-100 text-green-800 border-green-200",
  activity: "bg-brand/10 text-brand border-brand/20",
  other: "bg-muted text-text-main border-border",
  background: "bg-muted text-text-muted border-border",
};

const OCCURRENCE_LIMIT = 50;

interface TriagedAlertsProps {
  alerts: SiemAlert[];
  totalCount: number;
  scenarioId?: string | number | null;
}

/**
 * A lab's alerts sorted for grading: the scenario's expected rule and likely
 * student activity first, one row per rule, with the agent's own start-up
 * scans and status noise folded away (one click to show).
 */
export function TriagedAlerts({ alerts, totalCount, scenarioId }: TriagedAlertsProps) {
  const [showBackground, setShowBackground] = useState(false);
  const [raw, setRaw] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { groups, counts } = useMemo(() => triageAlerts(alerts, scenarioId), [alerts, scenarioId]);

  if (alerts.length === 0) {
    return <p className="text-sm text-text-muted">No alerts fired on this student&apos;s machines in this lab.</p>;
  }

  const visible = showBackground ? groups : groups.filter((g) => g.category !== "background");
  const relevant = counts.expected + counts.activity;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs" data-testid="triage-summary">
        {counts.expected > 0 && (
          <span className={`px-2 py-0.5 rounded-full border ${CATEGORY_STYLE.expected}`}>
            {counts.expected} expected for this scenario
          </span>
        )}
        <span className={`px-2 py-0.5 rounded-full border ${CATEGORY_STYLE.activity}`}>
          {counts.activity} likely student activity
        </span>
        {counts.other > 0 && (
          <span className={`px-2 py-0.5 rounded-full border ${CATEGORY_STYLE.other}`}>{counts.other} other</span>
        )}
        <span className={`px-2 py-0.5 rounded-full border ${CATEGORY_STYLE.background}`}>
          {counts.background} background{showBackground ? "" : " (hidden)"}
        </span>
        <span className="ml-auto flex gap-3">
          {counts.background > 0 && (
            <button type="button" className="text-brand hover:underline" onClick={() => setShowBackground((v) => !v)}>
              {showBackground ? "Hide background" : "Show background"}
            </button>
          )}
          <button type="button" className="text-brand hover:underline" onClick={() => setRaw((v) => !v)}>
            {raw ? "Grouped view" : "Every alert"}
          </button>
        </span>
      </div>

      {totalCount > alerts.length && (
        <p className="text-xs text-text-muted mb-2">
          Sorted from the newest {alerts.length} of {totalCount} alerts.
        </p>
      )}
      {relevant === 0 && counts.other === 0 && !raw && (
        <p className="text-sm text-text-muted mb-2">
          Only background alerts: nothing here points to the student&apos;s own actions. That&apos;s normal for
          scenarios whose activity Wazuh doesn&apos;t log (e.g. attacks from Kali, or web attacks before Apache logs
          are collected).
        </p>
      )}

      {raw ? (
        <AlertHistoryTable alerts={alerts} totalCount={totalCount} />
      ) : (
        visible.length > 0 && (
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-secondary">
                <tr>
                  <th className={SIEM_TH_CLASS}>Rule</th>
                  <th className={SIEM_TH_CLASS}>What it is</th>
                  <th className={SIEM_TH_CLASS}>Count</th>
                  <th className={SIEM_TH_CLASS}>Lvl</th>
                  <th className={SIEM_TH_CLASS}>First → last seen</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((g) => {
                  const isOpen = open === g.rule_id;
                  return (
                    <Fragment key={g.rule_id}>
                      <tr
                        className="border-t border-border cursor-pointer hover:bg-muted align-top"
                        onClick={() => setOpen(isOpen ? null : g.rule_id)}
                        aria-expanded={isOpen}
                      >
                        <td className={SIEM_TD.rule}>
                          <span className="inline-flex items-center gap-1">
                            {isOpen ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                            {g.rule_id}
                          </span>
                        </td>
                        <td className={SIEM_TD.desc}>
                          <span className={`inline-block mb-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${CATEGORY_STYLE[g.category]}`}>
                            {g.label}
                          </span>
                          <span className="block">{g.description}</span>
                        </td>
                        <td className={`${SIEM_TD.level} font-semibold`}>{g.count}</td>
                        <td className={`${SIEM_TD.level} ${SEVERITY_CLASS[severityBand(g.level)]}`}>{g.level}</td>
                        <td className={SIEM_TD.time}>
                          {formatAlertTime(g.first)}
                          {g.count > 1 && <span className="block text-text-muted">→ {formatAlertTime(g.last)}</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/40">
                          <td />
                          <td colSpan={4} className="px-2 py-2">
                            <ul className="space-y-0.5 font-mono text-[11px]">
                              {g.alerts.slice(0, OCCURRENCE_LIMIT).map((a, i) => (
                                <li key={`${a.timestamp}-${i}`}>
                                  {formatAlertTime(a.timestamp)} · {a.agent_name}
                                </li>
                              ))}
                            </ul>
                            {g.count > OCCURRENCE_LIMIT && (
                              <p className="text-text-muted mt-1">+ {g.count - OCCURRENCE_LIMIT} more</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
