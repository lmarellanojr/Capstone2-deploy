"use client";

import { useEffect, useState } from "react";
import { instructor, type StudentDiagnostics } from "@/lib/api";
import { mapErrorToMessage } from "@/lib/errorHandler";
import { formatSqliteDateSeconds } from "@/lib/sqliteTime";
import { locationLabel, reasonCopy, SCENARIO3_MILESTONES } from "@/lib/scoringDiagnostics";
import { Badge, LoadingSpinner } from "@/components/ui";

interface ScoringDiagnosticsProps {
  studentId: string;
}

/**
 * Why a Scenario 3 artifact check failed, per milestone and lab (instructor
 * only; the student still sees a generic result). One row per lab + milestone:
 * the latest reason, replaced once the milestone passes.
 */
export function ScoringDiagnostics({ studentId }: ScoringDiagnosticsProps) {
  const [data, setData] = useState<StudentDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    instructor
      .getStudentDiagnostics(studentId)
      .then((res) => !cancelled && setData(res))
      .catch((err: unknown) => !cancelled && setError(mapErrorToMessage(err).message));
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  // Feature off and nothing kept from before: show nothing at all.
  if (data && !data.enabled && data.diagnostics.length === 0) return null;

  return (
    <section className="card-surface overflow-hidden mb-6" aria-labelledby="scoring-diagnostics-heading">
      <div className="p-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 id="scoring-diagnostics-heading" className="text-lg font-bold text-text-main">
            Scenario 3 check reasons
          </h2>
          <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted border border-border rounded-full px-2 py-0.5">
            Instructor only
          </span>
        </div>
        <p className="text-xs text-text-muted">
          The latest reason each Scenario 3 artifact check failed, per lab. Students see only the generic result.
          {data ? ` Kept for ${data.retention_days} days.` : ""} Artifact contents are never stored.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-danger px-6 pb-6">Could not load check reasons: {error}</p>
      ) : data === null ? (
        <div className="px-6 pb-6">
          <LoadingSpinner message="Loading check reasons..." />
        </div>
      ) : data.diagnostics.length === 0 ? (
        <p className="text-sm text-text-muted px-6 pb-6">
          No Scenario 3 checks recorded for this student yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-text-muted text-left">
              <tr>
                <th scope="col" className="px-6 py-2 font-semibold">Milestone</th>
                <th scope="col" className="px-3 py-2 font-semibold">Lab</th>
                <th scope="col" className="px-3 py-2 font-semibold">Result</th>
                <th scope="col" className="px-3 py-2 font-semibold">Reason</th>
                <th scope="col" className="px-3 py-2 font-semibold">File read from</th>
                <th scope="col" className="px-3 py-2 font-semibold">Checks</th>
                <th scope="col" className="px-6 py-2 font-semibold">Last checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.diagnostics.map((d) => {
                const copy = reasonCopy(d.reason_code);
                return (
                  <tr key={`${d.pod_id}@${d.pod_created_at}#${d.milestone_id}`}>
                    <td className="px-6 py-2 text-text-main">
                      {SCENARIO3_MILESTONES[d.milestone_id] ?? `Milestone ${d.milestone_id}`}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      Pod {d.pod_id} · {formatSqliteDateSeconds(d.pod_created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={d.status === "PASS" ? "success" : d.status === "FAIL" ? "danger" : "warning"}>
                        {d.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {copy ? (
                        <>
                          <p className="font-medium text-text-main">{copy.label}</p>
                          <p className="text-xs text-text-muted">{copy.detail}</p>
                        </>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      <code>{locationLabel(d.location)}</code>
                      {d.copies > 1 && (
                        <p className="text-xs text-warning">{d.copies} copies found; this one was scored</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-muted">{d.check_count}</td>
                    <td className="px-6 py-2 text-text-muted">{formatSqliteDateSeconds(d.last_seen_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
