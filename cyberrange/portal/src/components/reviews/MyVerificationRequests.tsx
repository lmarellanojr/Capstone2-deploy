"use client";

import { useState } from "react";
import { MessageSquareText, RefreshCw } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { SCENARIOS, scenarioDisplayTitle } from "@/hooks/useScenarios";
import { useMyReviews, type MyReview } from "@/hooks/useMyReviews";
import { formatSqliteDate } from "@/lib/sqliteTime";
import { REVIEW_STATUS } from "./reviewStatus";
import { VerificationRequestModal } from "./VerificationRequestModal";

function labels(item: MyReview) {
  const scenario = SCENARIOS.find((s) => s.id === item.tracked.scenarioId);
  const milestone = scenario?.milestones.find((m) => m.id === item.tracked.milestoneId);
  return {
    scenarioLabel: scenario ? scenarioDisplayTitle(scenario) : `Scenario ${item.tracked.scenarioId}`,
    taskName: milestone?.name ?? (item.tracked.milestoneId ? `Task ${item.tracked.milestoneId}` : "Whole scenario"),
  };
}

/** The student's verification requests and the instructor's answers. Renders
 *  nothing until the student has made one, so it adds no dashboard clutter. */
export function MyVerificationRequests() {
  const { items, loading, error, refresh, resubmit } = useMyReviews();
  const [retrying, setRetrying] = useState<MyReview | null>(null);

  if (!loading && items.length === 0 && !error) return null;

  return (
    <section className="card-surface p-6 mb-8" aria-labelledby="requests-heading">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id="requests-heading" className="text-lg font-bold text-text-main">
          Verification requests
        </h2>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {error && (
        <div role="alert" className="mb-3 p-3 alert-warning text-sm">
          Couldn&apos;t load the latest status: {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Loading your requests">
          <div className="h-16 rounded-xl bg-muted" />
          <div className="h-16 rounded-xl bg-muted" />
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const { scenarioLabel, taskName } = labels(item);
            const status = item.case ? REVIEW_STATUS[item.case.status] : null;
            return (
              <li key={item.tracked.reviewId} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-text-muted">{scenarioLabel}</p>
                    <p className="font-semibold text-text-main">{taskName}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Sent{" "}
                      {item.case?.created_at
                        ? formatSqliteDate(item.case.created_at)
                        : new Date(item.tracked.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {status ? (
                    <Badge variant={status.variant} dot>
                      {status.label}
                    </Badge>
                  ) : (
                    <Badge>Status unavailable</Badge>
                  )}
                </div>

                {status && <p className="mt-2 text-sm text-text-secondary">{status.hint}</p>}

                {item.case?.feedback && (
                  <div className="mt-3 flex gap-2 rounded-lg bg-muted/60 p-3 text-sm">
                    <MessageSquareText size={16} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                    <p className="whitespace-pre-wrap text-text-main">{item.case.feedback}</p>
                  </div>
                )}

                {item.case?.status === "RETRY" && (
                  <div className="mt-3">
                    <Button variant="primary" size="sm" onClick={() => setRetrying(item)}>
                      Add detail and send again
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {retrying?.case && (
        <VerificationRequestModal
          isOpen
          onClose={() => setRetrying(null)}
          {...labels(retrying)}
          resubmit={{
            feedback: retrying.case.feedback,
            previousReason: retrying.case.conflict_reason,
            previousEvidence: retrying.case.report_text,
          }}
          onSubmit={(data) =>
            resubmit(retrying.tracked.reviewId, { conflictReason: data.conflictReason, reportText: data.reportText })
          }
        />
      )}
    </section>
  );
}
