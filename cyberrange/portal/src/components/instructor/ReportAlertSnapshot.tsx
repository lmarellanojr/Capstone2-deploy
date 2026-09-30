"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { instructor, type ReviewAlertSnapshot } from "@/lib/api";
import { mapErrorToMessage } from "@/lib/errorHandler";
import { formatSqliteDateSeconds } from "@/lib/sqliteTime";
import { LoadingSpinner } from "@/components/ui";
import { TriagedAlerts } from "./TriagedAlerts";

/**
 * The SIEM alerts frozen when the student submitted (or resubmitted) this
 * report -- the evidence as it stood at submission, independent of the
 * Wazuh archives.
 */
export function ReportAlertSnapshot({
  reviewId,
  scenarioId,
}: {
  reviewId: number | string;
  scenarioId?: number | string | null;
}) {
  const [snapshot, setSnapshot] = useState<ReviewAlertSnapshot | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    instructor
      .getReviewAlertSnapshot(reviewId)
      .then((res) => !cancelled && setSnapshot(res.snapshot))
      .catch((err: unknown) => !cancelled && setError(mapErrorToMessage(err).message));
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  return (
    <section className="card-surface p-6" aria-labelledby="report-snapshot-heading">
      <div className="flex items-center gap-2 mb-1">
        <Camera size={18} className="text-brand" aria-hidden="true" />
        <h2 id="report-snapshot-heading" className="text-lg font-bold text-text-main">
          Alerts captured with this report
        </h2>
      </div>
      {error ? (
        <p className="text-sm text-danger">Could not load the snapshot: {error}</p>
      ) : snapshot === undefined ? (
        <LoadingSpinner message="Loading snapshot..." />
      ) : snapshot === null ? (
        <p className="text-sm text-text-muted">
          No snapshot for this report. It was submitted before snapshots were recorded; use Past labs below to read
          that lab&apos;s alerts from the SIEM archives.
        </p>
      ) : (
        <>
          <p className="text-xs text-text-muted mb-3" data-testid="snapshot-meta">
            Captured {formatSqliteDateSeconds(snapshot.captured_at)}
            {snapshot.pod_id != null && (
              <>
                {" "}
                · Pod {snapshot.pod_id} · {formatSqliteDateSeconds(snapshot.window_start)} →{" "}
                {snapshot.end_estimated ? "≈ " : ""}
                {formatSqliteDateSeconds(snapshot.window_end)}
              </>
            )}
          </p>
          {snapshot.error ? (
            <p className="text-sm alert-warning p-2">
              {snapshot.error === "no lab found for this scenario"
                ? "The student had no lab for this scenario when they submitted, so there were no alerts to capture."
                : `Alerts couldn't be captured at submission (${snapshot.error}).`}
            </p>
          ) : (
            <TriagedAlerts alerts={snapshot.alerts} totalCount={snapshot.total_count} scenarioId={scenarioId} />
          )}
        </>
      )}
    </section>
  );
}
