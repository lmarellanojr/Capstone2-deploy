"use client";

import { useEffect, useState } from "react";
import { instructor, type InstructorLab, type InstructorLabAlerts } from "@/lib/api";
import { mapErrorToMessage } from "@/lib/errorHandler";
import { formatScenarioNumber } from "@/lib/scenarioLabels";
import { formatSqliteDateSeconds } from "@/lib/sqliteTime";
import { LoadingSpinner } from "@/components/ui";
import { TriagedAlerts } from "./TriagedAlerts";

interface LabHistoryProps {
  studentId: string;
  /** Review page: mark the labs for the report's scenario. */
  scenarioId?: number | string | null;
}

const labKey = (lab: InstructorLab) => `${lab.pod_id}@${lab.started_at}`;

/**
 * Every lab the student has run, with that lab's alerts read from the Wazuh
 * daily archives -- so evidence is still there after the lab has ended.
 */
export function LabHistory({ studentId, scenarioId }: LabHistoryProps) {
  const [labs, setLabs] = useState<InstructorLab[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<InstructorLabAlerts | null>(null);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    instructor
      .listStudentLabs(studentId)
      .then((res) => !cancelled && setLabs(res.labs))
      .catch((err: unknown) => !cancelled && setListError(mapErrorToMessage(err).message));
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const open = async (lab: InstructorLab) => {
    const key = labKey(lab);
    if (selected === key) {
      setSelected(null);
      return;
    }
    setSelected(key);
    setResult(null);
    setAlertsError(null);
    setLoadingAlerts(true);
    try {
      const res = await instructor.getLabAlerts(studentId, lab.pod_id, lab.started_at);
      setResult(res);
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
      setAlertsError(
        data?.error === "manager_unavailable"
          ? "The SIEM can't be reached right now. Try again in a moment."
          : mapErrorToMessage(err).message
      );
    } finally {
      setLoadingAlerts(false);
    }
  };

  if (listError) return <p className="text-sm text-danger">Could not load lab history: {listError}</p>;
  if (labs === null) return <LoadingSpinner message="Loading lab history..." />;
  if (labs.length === 0) return <p className="text-sm text-text-muted">This student hasn&apos;t run any labs yet.</p>;

  const relevant = (lab: InstructorLab) => scenarioId != null && Number(lab.scenario_id) === Number(scenarioId);

  return (
    <ul className="divide-y divide-border border border-border rounded-lg" aria-label="Past labs">
      {labs.map((lab) => {
        const key = labKey(lab);
        const isOpen = selected === key;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => open(lab)}
              aria-expanded={isOpen}
              className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-muted focus-ring ${
                relevant(lab) ? "bg-brand/5" : ""
              }`}
            >
              <span className="font-semibold text-text-main">{formatScenarioNumber(lab.scenario_id)}</span>
              <span className="text-text-muted">Pod {lab.pod_id}</span>
              <span className="text-text-muted">
                {formatSqliteDateSeconds(lab.started_at)} →{" "}
                {lab.active ? (
                  <span className="text-success font-medium">running</span>
                ) : (
                  <>
                    {lab.end_estimated && <span title="End time estimated (lab predates end-time tracking)">≈ </span>}
                    {formatSqliteDateSeconds(lab.ended_at)}
                  </>
                )}
              </span>
              {relevant(lab) && <span className="text-[10px] font-bold uppercase text-brand">This report&apos;s scenario</span>}
              <span className="ml-auto text-xs text-brand">{isOpen ? "Hide alerts" : "View alerts"}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3">
                {loadingAlerts ? (
                  <LoadingSpinner message="Reading SIEM archives..." />
                ) : alertsError ? (
                  <p className="text-sm text-danger">{alertsError}</p>
                ) : result ? (
                  <>
                    {lab.end_estimated && (
                      <p className="text-xs text-text-muted mb-2">
                        This lab ran before end times were recorded, so its window ends at the student&apos;s next
                        lab or the 8-hour limit.
                      </p>
                    )}
                    <TriagedAlerts alerts={result.alerts} totalCount={result.total_count} scenarioId={lab.scenario_id} />
                  </>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
