"use client";

import type { SiemAlert } from "@/lib/api";
import {
  formatAlertTime,
  severityBand,
  SIEM_TABLE_CLASS,
  SIEM_TABLE_VIEWPORT_CLASS,
  SIEM_TD,
  SIEM_TH_CLASS,
  type SeverityBand,
} from "@/components/scenario/siemAlertQuery";

const SEVERITY_CLASS: Record<SeverityBand, string> = {
  high: "text-red-600",
  medium: "text-yellow-600",
  low: "text-blue-600",
};

/**
 * Static (non-polling) alert table for evidence that is already fixed: an ended
 * lab's archived alerts, or the snapshot frozen with a report. Same columns,
 * styling and time format as the live SiemAlertViewer.
 */
export function AlertHistoryTable({ alerts, totalCount }: { alerts: SiemAlert[]; totalCount: number }) {
  if (alerts.length === 0) {
    return <p className="text-sm text-text-muted">No alerts fired on this student&apos;s machines in this lab.</p>;
  }
  return (
    <>
      <p className="text-xs text-text-muted mb-2" data-testid="alert-history-count">
        {totalCount > alerts.length
          ? `Showing the newest ${alerts.length} of ${totalCount} alerts`
          : `${totalCount} alert${totalCount === 1 ? "" : "s"}`}
      </p>
      <div className={SIEM_TABLE_VIEWPORT_CLASS}>
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
            {alerts.map((a, i) => (
              <tr key={`${a.timestamp}-${a.rule_id}-${i}`} className="border-t border-border">
                <td className={SIEM_TD.time}>{formatAlertTime(a.timestamp)}</td>
                <td className={SIEM_TD.rule}>{a.rule_id}</td>
                <td className={SIEM_TD.agent}>{a.agent_name}</td>
                <td className={`${SIEM_TD.level} ${SEVERITY_CLASS[severityBand(a.rule_level)]}`}>{a.rule_level}</td>
                <td className={SIEM_TD.desc}>{a.rule_description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
