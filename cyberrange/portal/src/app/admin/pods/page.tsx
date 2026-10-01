"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, Button, LoadingSpinner } from "@/components/ui";
import { DestroyPodConfirmation } from "@/components/provisioning/DestroyPodConfirmation";
import { adminNavItems } from "@/lib/navigation";
import { useAdminPods } from "@/hooks/useAdminPods";
import { useAdminDestroyPoll } from "@/hooks/useAdminDestroyPoll";
import { admin } from "@/lib/api";
import { adminPodBadgeVariant, canForceDestroy } from "@/lib/adminBadges";
import { formatSqliteDate } from "@/lib/sqliteTime";
import { useToastContext } from "@/context/ToastContext";

// No Reset control anywhere on this page (review finding: don't surface
// backlog/PR references as user-facing copy) -- PR #50 never added a
// reset/recreate API, so Destroy is the only lifecycle action available.
export default function AdminPodsPage() {
  const { pods, capacity, loading, error, capacityError, refresh } = useAdminPods();
  const { success, error: showError } = useToastContext();
  const [confirmingPodId, setConfirmingPodId] = useState<number | null>(null);
  const [destroyingPodId, setDestroyingPodId] = useState<number | null>(null);
  const destroyPoll = useAdminDestroyPoll(destroyingPodId);

  const handleConfirmDestroy = async () => {
    if (confirmingPodId === null) return;
    const podId = confirmingPodId;
    await admin.forceDestroyPod(podId);
    setConfirmingPodId(null);
    setDestroyingPodId(podId);
  };

  useEffect(() => {
    if (destroyingPodId === null) return;
    // Don't clear destroyingPodId until refresh() has actually replaced the
    // stale pod row -- otherwise there's a window where p.status is still
    // the pre-destroy value, canForceDestroy(p.status) re-enables Destroy,
    // and a second force-destroy call would return 409 (review finding).
    if (destroyPoll.status === "DESTROYED") {
      success(`Pod ${destroyingPodId} destroyed successfully`);
      void refresh().finally(() => setDestroyingPodId(null));
    } else if (destroyPoll.error) {
      // 10s, not the 3s default -- "Verify manually" needs to actually be
      // read, not vanish while the row is still settling back to normal
      // (review finding; DestroyPodConfirmation already uses 4000 for its
      // own errors).
      showError(destroyPoll.error, 10000);
      void refresh().finally(() => setDestroyingPodId(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destroyPoll.status, destroyPoll.error, destroyingPodId]);

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Pods</h1>
          <p className="text-text-muted mt-1">All provisioned pods across students</p>
        </div>
        {capacity ? (
          <div className="text-sm text-text-muted">
            <span className="font-semibold text-text-main">{capacity.active_pods}</span> /{" "}
            {capacity.max_pods} active pods
            {capacity.available_mb !== null && (
              <span className="ml-2">· {Math.round(capacity.available_mb / 1024)} GB free</span>
            )}
          </div>
        ) : capacityError ? (
          <div className="text-sm text-text-muted">Capacity unavailable</div>
        ) : null}
      </div>

      {error && (
        <div className="mb-4 p-3 alert-error text-sm">
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading pods..." />
        </div>
      ) : error ? null : pods.length === 0 && capacityError ? (
        // apiProxy's offline fallback answers GET /pods with a 200 empty
        // list when the provisioning API is unreachable (apiProxy.ts:53-55),
        // so an outage looks identical to a genuinely empty range unless
        // capacityError (which has no such fallback) is checked too (review
        // finding).
        <div className="card-surface p-10 text-center">
          <p className="text-danger text-sm font-semibold">Pod list may be unavailable</p>
          <p className="text-text-muted text-sm mt-1">The provisioning API could not be reached.</p>
        </div>
      ) : pods.length === 0 ? (
        <div className="card-surface p-10 text-center">
          <p className="text-text-muted text-sm">No live pods right now.</p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th className="py-3 px-4 font-semibold">Pod ID</th>
                  <th className="py-3 px-4 font-semibold">Student</th>
                  <th className="py-3 px-4 font-semibold">Scenario</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Created</th>
                  <th className="py-3 px-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p) => {
                  const isBeingDestroyed = destroyingPodId === p.pod_id;
                  // Assume DESTROYING the instant it's confirmed (the backend
                  // sets it synchronously on accept) rather than waiting up to
                  // one poll interval for the first tick to confirm it
                  // (review finding).
                  const liveStatus = isBeingDestroyed ? destroyPoll.status ?? "DESTROYING" : p.status;
                  return (
                    <tr key={p.pod_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4 font-mono text-text-main">
                        <Link href={`/admin/pods/${p.pod_id}`} className="hover:text-brand hover:underline">
                          {p.pod_id}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-text-muted">{p.student_id}</td>
                      <td className="py-3 px-4 text-text-muted">{p.scenario_id ?? "—"}</td>
                      <td className="py-3 px-4">
                        <Badge variant={adminPodBadgeVariant(liveStatus)}>{liveStatus}</Badge>
                      </td>
                      <td className="py-3 px-4 text-text-muted">
                        {formatSqliteDate(p.created_at)}
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={destroyingPodId !== null || !canForceDestroy(p.status)}
                          loading={isBeingDestroyed}
                          title={
                            destroyingPodId !== null && !isBeingDestroyed
                              ? "Another destroy is in progress"
                              : canForceDestroy(p.status)
                                ? "Force-destroy this pod"
                                : `Cannot force-destroy a pod in ${p.status}`
                          }
                          onClick={() => setConfirmingPodId(p.pod_id)}
                        >
                          {isBeingDestroyed ? "Destroying..." : "Destroy"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmingPodId !== null && (
        <DestroyPodConfirmation
          podId={confirmingPodId}
          isOpen={confirmingPodId !== null}
          onCancel={() => setConfirmingPodId(null)}
          onConfirm={handleConfirmDestroy}
        />
      )}
    </LayoutWrapper>
  );
}
