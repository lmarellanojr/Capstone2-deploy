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
import { useToastContext } from "@/context/ToastContext";

export default function AdminPodsPage() {
  const { pods, capacity, loading, error, refresh } = useAdminPods();
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
    if (destroyPoll.status === "DESTROYED") {
      success(`Pod ${destroyingPodId} destroyed successfully`);
      setDestroyingPodId(null);
      void refresh();
    } else if (destroyPoll.error) {
      showError(destroyPoll.error);
      setDestroyingPodId(null);
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destroyPoll.status, destroyPoll.error, destroyingPodId]);

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Pods</h1>
          <p className="text-text-muted mt-1">All provisioned pods across students</p>
          <p className="text-xs text-text-muted mt-1">
            Gap: no reset/recreate API exists yet (PR #50 added inspection and force-destroy
            only) — Destroy is the only lifecycle action available here.
          </p>
        </div>
        {capacity && (
          <div className="text-sm text-text-muted">
            <span className="font-semibold text-text-main">{capacity.active_pods}</span> /{" "}
            {capacity.max_pods} active pods
            {capacity.available_mb !== null && (
              <span className="ml-2">· {Math.round(capacity.available_mb / 1024)} GB free</span>
            )}
          </div>
        )}
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
      ) : error ? null : pods.length === 0 ? (
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
                  const liveStatus = isBeingDestroyed && destroyPoll.status ? destroyPoll.status : p.status;
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
                        {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
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
