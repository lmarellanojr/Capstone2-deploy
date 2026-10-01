"use client";

import { ShieldAlert } from "lucide-react";
import { SiemAlertViewer } from "@/components/scenario/SiemAlertViewer";
import type { InstructorPod } from "@/lib/api";
import { formatScenarioNumber } from "@/lib/scenarioLabels";
import { LabHistory } from "./LabHistory";

interface StudentAlertsPanelProps {
  studentId: string;
  activePod: InstructorPod | null | undefined;
  /** When set (review detail), note if the running lab is a different scenario. */
  scenarioId?: number | string | null;
}

/**
 * Read-only SIEM alerts for one student (SIEM audit gap 6): the running lab
 * live, plus every earlier lab from the Wazuh daily archives. Same pod-scoped,
 * allowlisted fields the student sees — never the raw Wazuh dashboard.
 */
export function StudentAlertsPanel({ studentId, activePod, scenarioId }: StudentAlertsPanelProps) {
  const running = activePod && activePod.status === "ACTIVE" ? activePod : null;
  const otherScenario =
    running && scenarioId != null && running.scenario_id != null && Number(running.scenario_id) !== Number(scenarioId);

  return (
    <section className="card-surface p-6" aria-labelledby="student-alerts-heading">
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert size={18} className="text-brand" aria-hidden="true" />
        <h2 id="student-alerts-heading" className="text-lg font-bold text-text-main">
          SIEM alerts
        </h2>
        <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted border border-border rounded-full px-2 py-0.5">
          Read-only
        </span>
      </div>
      <p className="text-xs text-text-muted mb-4">
        The Wazuh alerts that fired on this student&apos;s current lab, the same view they see. Compare the
        rule IDs and times in their report with what actually fired.
      </p>

      {running ? (
        <>
          {otherScenario && (
            <p className="text-xs alert-warning p-2 mb-3">
              Their running lab is {formatScenarioNumber(running.scenario_id)}, not the scenario in this report.
            </p>
          )}
          <SiemAlertViewer podId={running.pod_id} source="staff" />
        </>
      ) : (
        <p className="text-sm text-text-muted">No lab running right now. Earlier labs are under Past labs.</p>
      )}

      <h3 className="text-sm font-semibold text-text-main mt-6 mb-2">Past labs</h3>
      <p className="text-xs text-text-muted mb-3">
        Alerts from any lab this student has run, read from the SIEM&apos;s daily archives.
      </p>
      <LabHistory studentId={studentId} scenarioId={scenarioId} />
    </section>
  );
}
