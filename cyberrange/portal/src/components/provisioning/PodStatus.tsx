"use client";

import { useState, useEffect } from "react";
import { Badge, Button, LoadingSpinner } from "@/components/ui";
import { Pod } from "@/lib/api";
import { podIps } from "@/lib/podIps";
import { MAX_STUDENT_PODS, usePods } from "@/hooks/usePods";
import { LabCountdown } from "@/components/scenario/LabCountdown";
import { useProvisioning } from "@/hooks/useProvisioning";
import { useToastContext } from "@/context/ToastContext";
import { PodDestroyingProgress } from "./PodDestroyingProgress";
import { DestroyPodConfirmation } from "./DestroyPodConfirmation";

interface PodStatusProps {
  onConnect?: (pod: Pod) => void;
  onPodDestroyed?: () => void;
  /** Increment to force a list refresh (e.g. after create completes). */
  refreshSignal?: number;
  /** Notifies parent when the filtered pod list changes (for Active Pods stat). */
  onPodsChange?: (pods: Pod[]) => void;
}

export function PodStatus({
  onConnect,
  onPodDestroyed,
  refreshSignal,
  onPodsChange,
}: PodStatusProps) {
  const { pods, loading, error, refreshPods, toastMessage, clearToastMessage, fetchedAtMs } = usePods();
  const { destroyPod, loading: destroyLoading, error: destroyError } = useProvisioning();
  const { success, error: showError } = useToastContext();
  const [destroyingId, setDestroyingId] = useState<number | null>(null);
  // Set once the destroy request has been accepted by the API; drives the
  // polling progress view for that pod card. Distinct from destroyingId,
  // which only tracks the in-flight DELETE request itself.
  const [pollingDestroyId, setPollingDestroyId] = useState<number | null>(null);
  const [confirmationPodId, setConfirmationPodId] = useState<number | null>(null);

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

  const getStatusBadgeVariant = (status: string) => {
    if (status === "ACTIVE" || status === "RUNNING") return "success";
    if (status === "PROVISIONING") return "warning";
    return "danger";
  };

  const handleDestroyClick = (podId: number) => {
    setConfirmationPodId(podId);
  };

  const handleConfirmDestroy = async () => {
    if (confirmationPodId === null) return;

    const podId = confirmationPodId;
    try {
      setDestroyingId(podId);
      await destroyPod(podId);
      // Destroy accepted — start polling for terminal state instead of
      // refreshing immediately, so the user sees the DESTROYING progress.
      setPollingDestroyId(podId);
      setConfirmationPodId(null);
    } catch (err) {
      showError(`Failed to destroy pod: ${err instanceof Error ? err.message : "Unknown error"}`);
      console.error("Failed to destroy pod:", err);
      setDestroyingId(null);
      // Modal will show the error and stay open for retry
      throw err;
    }
  };

  const handleCancelDestroy = () => {
    setConfirmationPodId(null);
  };

  const handleDestroyComplete = async (podId: number) => {
    success(`Pod ${podId} destroyed successfully`);
    setPollingDestroyId(null);
    // silent: no loading flash; notify: toast if post-destroy list fetch fails.
    await refreshPods({ silent: true, notify: true });
    onPodDestroyed?.();
  };

  const handleDestroyError = (podId: number, err: Error) => {
    showError(`Failed to destroy pod ${podId}: ${err.message}`);
    setPollingDestroyId(null);
  };

  if (loading) {
    return (
      <div className="card-surface p-6">
        <h3 className="text-lg font-bold text-text-main mb-4">Running Pods</h3>
        <div className="flex justify-center py-8">
          <LoadingSpinner message="Loading pods..." />
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-text-main">
          Running Pods ({pods.length}/{MAX_STUDENT_PODS})
        </h3>
        {pods.length > 0 && (
          <button
            onClick={() => refreshPods()}
            className="text-xs text-brand hover:underline font-semibold"
            disabled={loading}
          >
            Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 alert-error text-sm">
          <p>{error}</p>
        </div>
      )}

      {destroyError && (
        <div className="mb-4 p-3 alert-error text-sm">
          <p>{destroyError}</p>
        </div>
      )}

      {pods.length === 0 ? (
        <p className="text-text-muted text-center py-8 text-sm">
          No active pods. Create one to get started.
        </p>
      ) : (
        <div className="space-y-4">
          {pods.map((pod) => {
            const ips = podIps(pod.pod_id);

            // In-flight DELETE *or* a pod already DESTROYING on list load
            // (e.g. refresh mid-destroy) should show destroy progress — do
            // not require another DELETE to enter the destroy UX.
            if (pollingDestroyId === pod.pod_id || pod.status === "DESTROYING") {
              return (
                <div
                  key={pod.pod_id}
                  className="pod-card destroying border border-border rounded-lg p-4 bg-secondary"
                >
                  <h4 className="font-semibold text-text-main mb-2">Pod {pod.pod_id}</h4>
                  <PodDestroyingProgress
                    podId={pod.pod_id}
                    onComplete={() => handleDestroyComplete(pod.pod_id)}
                    onError={(err) => handleDestroyError(pod.pod_id, err)}
                  />
                </div>
              );
            }

            return (
              <div
                key={pod.pod_id}
                className="border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/50 transition bg-secondary"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-semibold text-text-main">Pod {pod.pod_id}</h4>
                    <Badge variant={getStatusBadgeVariant(pod.status)}>{pod.status}</Badge>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm text-text-muted">
                    <div>
                      <p className="text-xs mb-0.5">Student</p>
                      <p className="font-semibold text-text-main">{pod.student_id}</p>
                    </div>
                    <div>
                      <p className="text-xs mb-0.5">Created</p>
                      <p className="font-semibold text-text-main">
                        {pod.created_at ? new Date(pod.created_at).toLocaleDateString() : "—"}
                      </p>
                    </div>
                    {pod.status === "ACTIVE" && pod.expires_at && (
                      <div>
                        <p className="text-xs mb-0.5">Time left</p>
                        <p className="font-semibold text-text-main">
                          <LabCountdown remainingSeconds={pod.remaining_seconds} fetchedAtMs={fetchedAtMs} />
                        </p>
                      </div>
                    )}
                  </div>

                  {pod.status === "ACTIVE" && (
                    <div className="mt-3 pt-3 border-t border-border text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wider text-brand mb-2">
                        Target IPs
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: "Kali", ip: ips.kali },
                          { label: "Meta", ip: ips.meta },
                          { label: "DVWA", ip: ips.dvwa },
                        ].map(({ label, ip }) => (
                          <div
                            key={label}
                            className="bg-muted px-2 py-1 rounded border border-border text-xs"
                          >
                            <span className="text-text-muted mr-1">{label}:</span>
                            <code className="text-text-main font-mono">{ip}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  {pod.status === "ACTIVE" && (
                    <Button variant="primary" size="sm" onClick={() => onConnect?.(pod)}>
                      Connect
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDestroyClick(pod.pod_id)}
                    disabled={destroyingId === pod.pod_id || destroyLoading}
                    loading={destroyingId === pod.pod_id && destroyLoading}
                  >
                    {destroyingId === pod.pod_id ? "Destroying..." : "Destroy"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmationPodId !== null && (
        <DestroyPodConfirmation
          podId={confirmationPodId}
          isOpen={confirmationPodId !== null}
          onCancel={handleCancelDestroy}
          onConfirm={handleConfirmDestroy}
        />
      )}
    </div>
  );
}