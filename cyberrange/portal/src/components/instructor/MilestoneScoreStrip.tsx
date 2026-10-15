"use client"

import { Badge } from "@/components/ui"
import type { InstructorMilestone } from "@/lib/api"
import { formatScenarioNumber } from "@/lib/scenarioLabels"
import { describeSiemDetection } from "@/lib/siemDetection"

function statusVariant(status: string): "success" | "danger" | "warning" {
  if (status === "PASS") return "success"
  if (status === "FAIL") return "danger"
  return "warning"
}

/**
 * Compact milestone status + detection score summary shown above SIEM logs so
 * instructors can compare scores with the alert stream without scrolling away.
 */
export function MilestoneScoreStrip({ milestones }: { milestones: InstructorMilestone[] }) {
  if (milestones.length === 0) {
    return <p className="text-sm text-text-muted mb-3">No milestone scores recorded yet for this student.</p>
  }

  const recent = milestones.slice(0, 8)

  return (
    <div className="mb-4" data-testid="milestone-score-strip">
      <h3 className="text-sm font-semibold text-text-main mb-2">Detection scores next to these logs</h3>
      <p className="text-xs text-text-muted mb-2">
        Recent attempts: task status and SIEM detection score (0/1), not catalog points. Full history is in the
        Milestones table below.
      </p>
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-secondary text-left text-text-muted">
            <tr>
              <th className="py-2 px-3 font-semibold">Scenario</th>
              <th className="py-2 px-3 font-semibold">Milestone</th>
              <th className="py-2 px-3 font-semibold">Status</th>
              <th className="py-2 px-3 font-semibold">Detection score</th>
              <th className="py-2 px-3 font-semibold">SIEM detection</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((m, idx) => (
              <tr key={`${m.scenario_id}-${m.milestone_id}-${idx}`} className="border-t border-border">
                <td className="py-2 px-3 text-text-main">{formatScenarioNumber(m.scenario_id)}</td>
                <td className="py-2 px-3 text-text-muted">{m.milestone_id}</td>
                <td className="py-2 px-3">
                  <Badge variant={statusVariant(m.status)}>{m.status}</Badge>
                </td>
                <td className="py-2 px-3 tabular-nums text-text-main">
                  {m.detection_score == null ? "—" : m.detection_score}
                </td>
                <td className="py-2 px-3 text-text-muted">
                  {describeSiemDetection(m.scenario_id, m.milestone_id, m.detection_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {milestones.length > recent.length && (
        <p className="text-xs text-text-muted mt-1">
          Showing the newest {recent.length} of {milestones.length} attempts.
        </p>
      )}
    </div>
  )
}
