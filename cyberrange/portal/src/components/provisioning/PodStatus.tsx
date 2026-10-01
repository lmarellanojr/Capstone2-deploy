"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FlaskConical, RefreshCw } from "lucide-react";
import { Badge, Button, LoadingSpinner, buttonClasses } from "@/components/ui";
import { Pod } from "@/lib/api";
import { podIps } from "@/lib/podIps";
import { formatSqliteDate } from "@/lib/sqliteTime";
import { MAX_STUDENT_PODS, usePods } from "@/hooks/usePods";
import { LabCountdown } from "@/components/scenario/LabCountdown";
import { useProvisioning } from "@/hooks/useProvisioning";
import { useToastContext } from "@/context/ToastContext";
import { useScenarios, scenarioDisplayTitle } from "@/hooks/useScenarios";
import { PodDestroyingProgress } from "./PodDestroyingProgress";
import { DestroyPodConfirmation } from "./DestroyPodConfirmation";

interface PodStatusProps {
  onConnect?: (pod: Pod) => void;
  onPodDestroyed?: () => void;
  /** Increment to force a list refresh (e.g. after create completes). */
  refreshSignal?: number;
  /** Notifies parent when the filtered pod list changes (for the dashboard stats). */
  onPodsChange?: (pods: Pod[]) => void;
}

// Student-facing status words. The API values (ACTIVE, PROVISIONING, …) are
// operator vocabulary; students just need to know whether they can use it.
function statusBadge(status: string): { label: string; variant: "success" | "warning" | "danger" | "default" } {
  if (status === "ACTIVE" || status === "RUNNING") return { label: "Active", variant: "success" };
  if (status === "PROVISIONING") return { label: "Starting", variant: "warning" };
  if (status === "DESTROYING") return { label: "Ending", variant: "default" };
  return { label: status.charAt(0) + status.slice(1).toLowerCase(), variant: "danger" };
}

export function PodStatus({
  onConnect,
  onPodDestroyed,
  refreshSignal,
  onPodsChange,
}: PodStatusProps) {
  const { pods, loading, error, refreshPods, toastMessage, clearToastMessage, fetchedAtMs } = usePods();
  const { destroyPod, loading: destroyLoading, error: destroyError } = useProvisioning();
  const { error: showError } = useToastContext();
  const scenarios = useScenarios();
  const [destroyingId, setDestroyingId] = useState<number | null>(null);
  // Set once the destroy request has been accepted by the API; drives the
  // polling progress view for that pod card. Distinct from destroyingId,
  // which only tracks the in-flight DELETE request itself.
  const [pollingDestroyId, setPollingDestroyId] = useState<number | null>(null);
  const [confirmationPodId, setConfirmationPodId] = useState<number | null>(null);

  const labLabel = (pod: Pod) => {
    const sid = pod.scenario_id != null ? String(pod.scenario_id).padStart(2, "0") : "";
    const scenario = scenarios.find((s) => s.id === sid);
    return scenario ? scenarioDisplayTitle(scenario) : `Lab session ${pod.pod_id}`;
  };

  // Surface list-fetch failures via toast (mapErrorToMessage applied in usePods).
  useEffect(() => {
    if (toastMessage) {
      showError(toastMessage);
      clearToastMessage();
    }
  }, [toastMessage, showError, clearToastMessage]);

  // Parent-driven refresh after create completes / overlay closes.
  // silent: no loading flash; notify: toast if the post-create list fetch fails.
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal > 0) {
      void refreshPods({ silent: true, notify: true });
    }
  }, [refreshSignal, refreshPods]);

  useEffect(() => {
    onPodsChange?.(pods);
  }, [pods, onPodsChange]);

  const handleConfirmDestroy = async () => {
    if (confirmationPodId === null) return;

    const podId = confirmationPodId;
    try {
      setDestroyingId(podId);
      await destroyPod(podId);
      // Destroy accepted — start polling for terminal state instead of
      // refreshing immediately, so the user sees the progress.
      setPollingDestroyId(podId);
      setConfirmationPodId(null);
    } catch (err) {
      showError(`Couldn't end the lab session: ${err instanceof Error ? err.message : "Unknown error"}`);
      console.error("Failed to destroy pod:", err);
      setDestroyingId(null);
      // Modal will show the error and stay open for retry
      throw err;
    }
  };

  const handleDestroyComplete = async () => {
    // PodDestroyingProgress already showed the "session ended" toast.
    setPollingDestroyId(null);
    setDestroyingId(null);
    // silent: no loading flash; notify: toast if post-destroy list fetch fails.
    await refreshPods({ silent: true, notify: true });
    onPodDestroyed?.();
  };

  const handleDestroyError = (err: Error) => {
    showError(`Couldn't end the lab session: ${err.message}`);
    setPollingDestroyId(null);
  };

  const confirmationPod = pods.find((p) => p.pod_id === confirmationPodId);

  return (
    <section className="card-surface p-6" aria-labelledby="lab-sessions-heading">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id="lab-sessions-heading" className="text-lg font-bold text-text-main">
          Your lab sessions
          {!loading && (
            <span className="ml-2 text-sm font-medium text-text-muted">
              {pods.length} of {MAX_STUDENT_PODS}
            </span>
          )}
        </h2>
        {pods.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => refreshPods()} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner message="Checking your lab sessions…" />
        </div>
      ) : (
        <>
          {error && (
            <div role="alert" className="mb-4 p-3 alert-error text-sm">
              {error}
            </div>
          )}

          {destroyError && (
            <div role="alert" className="mb-4 p-3 alert-error text-sm">
              {destroyError}
            </div>
          )}

          {pods.length === 0 ? (
            <div className="text-center py-8 px-4 border border-dashed border-border rounded-xl">
              <FlaskConical size={28} className="mx-auto mb-3 text-text-faint" aria-hidden="true" />
              <p className="font-semibold text-text-main">No lab running right now</p>
              <p className="text-sm text-text-muted mt-1 mb-4">
                Start a lab from My Labs — it runs in its own private environment.
              </p>
              <Link href="/scenarios" className={buttonClasses("primary", "sm")}>
                Browse labs
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {pods.map((pod) => {
                const ips = podIps(pod.pod_id);
                const badge = statusBadge(pod.status);

                // In-flight DELETE *or* a pod already DESTROYING on list load
                // (e.g. refresh mid-destroy) should show destroy progress — do
                // not require another DELETE to enter the destroy UX.
                if (pollingDestroyId === pod.pod_id || pod.status === "DESTROYING") {
                  return (
                    <div key={pod.pod_id} className="pod-card destroying border border-border rounded-xl p-4 bg-secondary">
                      <h3 className="font-semibold text-text-main mb-2">{labLabel(pod)}</h3>
                      <PodDestroyingProgress
                        podId={pod.pod_id}
                        studentFacing
                        onComplete={handleDestroyComplete}
                        onError={handleDestroyError}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={pod.pod_id}
                    className="border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4 bg-secondary"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="font-semibold text-text-main">{labLabel(pod)}</h3>
                        <Badge variant={badge.variant} dot>
                          {badge.label}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-muted">
                        <p>
                          Started{" "}
                          <span className="font-medium text-text-main">
                            {formatSqliteDate(pod.created_at)}
                          </span>
                        </p>
                        {pod.status === "ACTIVE" && pod.expires_at && (
                          <LabCountdown remainingSeconds={pod.remaining_seconds} fetchedAtMs={fetchedAtMs} />
                        )}
                      </div>

                      {pod.status === "ACTIVE" && (
                        <details className="mt-3 group">
                          <summary className="text-xs font-semibold text-text-muted cursor-pointer select-none hover:text-text-main w-fit rounded focus-ring">
                            Connection details
                          </summary>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {[
                              { label: "Kali", ip: ips.kali },
                              { label: "Meta", ip: ips.meta },
                              { label: "DVWA", ip: ips.dvwa },
                            ].map(({ label, ip }) => (
                              <div key={label} className="bg-muted px-2 py-1 rounded border border-border text-xs">
                                <span className="text-text-muted mr-1">{label}:</span>
                                <code className="text-text-main font-mono">{ip}</code>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>

                    <div className="flex gap-2 flex-shrink-0">
                      {pod.status === "ACTIVE" && (
                        <Button variant="primary" size="sm" onClick={() => onConnect?.(pod)}>
                          Open lab
                        </Button>
                      )}
                      <Button
                        variant="danger-outline"
                        size="sm"
                        onClick={() => setConfirmationPodId(pod.pod_id)}
                        disabled={destroyingId === pod.pod_id || destroyLoading}
                        loading={destroyingId === pod.pod_id && destroyLoading}
                      >
                        {destroyingId === pod.pod_id ? "Ending…" : "End session"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {confirmationPodId !== null && (
        <DestroyPodConfirmation
          podId={confirmationPodId}
          isOpen={confirmationPodId !== null}
          onCancel={() => setConfirmationPodId(null)}
          onConfirm={handleConfirmDestroy}
          studentFacing
          labLabel={confirmationPod ? labLabel(confirmationPod) : undefined}
        />
      )}
    </section>
  );
}
