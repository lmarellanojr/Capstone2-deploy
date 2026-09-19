"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, Button, LoadingSpinner } from "@/components/ui";
import { DestroyPodConfirmation } from "@/components/provisioning/DestroyPodConfirmation";
import { LabCountdown } from "@/components/scenario/LabCountdown";
import { adminNavItems } from "@/lib/navigation";
import { useAdminPodDetail } from "@/hooks/useAdminPodDetail";
import { useAdminDestroyPoll } from "@/hooks/useAdminDestroyPoll";
import { admin } from "@/lib/api";
import { adminPodBadgeVariant, canForceDestroy } from "@/lib/adminBadges";
import { useToastContext } from "@/context/ToastContext";

interface PageProps {
  params: { id: string };
}

export default function AdminPodDetailPage({ params }: PageProps) {
  const podId = Number(params.id);
  const { pod, loading, error, notFound, fetchedAtMs, refresh } = useAdminPodDetail(podId);
  const { success, error: showError } = useToastContext();
  const [confirming, setConfirming] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const destroyPoll = useAdminDestroyPoll(destroying ? podId : null);

  const handleConfirmDestroy = async () => {
    await admin.forceDestroyPod(podId);
    setConfirming(false);
    setDestroying(true);
  };

  useEffect(() => {
    if (!destroying) return;
    // Don't clear destroying until refresh() has actually replaced the
    // stale pod -- otherwise there's a window where pod.status is still the
    // pre-destroy value, canForceDestroy(pod.status) re-enables Destroy, and
    // a second force-destroy call would return 409 (review finding).
    if (destroyPoll.status === "DESTROYED") {
      success(`Pod ${podId} destroyed successfully`);
      void refresh().finally(() => setDestroying(false));
    } else if (destroyPoll.error) {
      showError(destroyPoll.error);
      void refresh().finally(() => setDestroying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destroyPoll.status, destroyPoll.error, destroying]);

  // Assume DESTROYING the instant it's confirmed (the backend sets it
  // synchronously on accept) rather than waiting up to one poll interval for
  // the first tick to confirm it (review finding).
  const liveStatus = destroying ? destroyPoll.status ?? "DESTROYING" : pod?.status;

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
      <div className="mb-6">
        <Link href="/admin/pods" className="text-sm text-brand font-semibold hover:underline">
          ← Back to Pods
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading pod..." />
        </div>
      ) : notFound ? (
        <div className="card-surface p-10 text-center">
          <p className="text-lg font-semibold text-text-main mb-1">Pod not found</p>
          <p className="text-text-muted text-sm">No pod with ID &quot;{params.id}&quot; on record.</p>
        </div>
      ) : error ? (
        <div className="p-3 alert-error text-sm">
          <p>{error}</p>
        </div>
      ) : pod ? (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-text-main">Pod {pod.pod_id}</h1>
              <p className="text-text-muted mt-1">Owned by {pod.student_id}</p>
            </div>
            <Button
              variant="danger"
              disabled={destroying || !canForceDestroy(pod.status)}
              loading={destroying}
              title={
                canForceDestroy(pod.status)
                  ? "Force-destroy this pod"
                  : `Cannot force-destroy a pod in ${pod.status}`
              }
              onClick={() => setConfirming(true)}
            >
              {destroying ? "Destroying..." : "Destroy"}
            </Button>
          </div>

          <div className="card-surface p-6">
            {/* No "Last Heartbeat" field here on purpose (review finding):
                GET /pods/{id}/status bumps last_heartbeat for ANY authorized
                caller while ACTIVE (pods_router.py:268-272), owner or admin,
                not just genuine student polling. Opening this page or a
                destroy-poll tick would make the value reflect the admin's own
                last visit, not student activity -- misleading rather than
                useful. Backend fix (scope to the owner's own status call) is
                a follow-up, not part of this PR. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-text-muted mb-0.5">Status</p>
                {liveStatus && <Badge variant={adminPodBadgeVariant(liveStatus)}>{liveStatus}</Badge>}
              </div>
              <div>
                <p className="text-xs text-text-muted mb-0.5">Scenario</p>
                <p className="font-semibold text-text-main">{pod.scenario_id ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-0.5">Created</p>
                <p className="font-semibold text-text-main">
                  {pod.created_at ? new Date(pod.created_at).toLocaleString() : "—"}
                </p>
              </div>
              {liveStatus === "ACTIVE" && !pod.ttl_expired && (
                // LabCountdown renders its own "Time left mm:ss" text -- no outer
                // label here, that duplicated it (review finding). Gated on
                // liveStatus, not pod.status, so this hides once Destroy is
                // confirmed instead of continuing to tick during teardown.
                <div className="flex items-end">
                  <LabCountdown remainingSeconds={pod.remaining_seconds} fetchedAtMs={fetchedAtMs} />
                </div>
              )}
              <div>
                <p className="text-xs text-text-muted mb-0.5">Connection ID</p>
                <p className="font-semibold text-text-main">{pod.connection_id ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-0.5">Wazuh Agent</p>
                <p className="font-semibold text-text-main">{pod.wazuh_agent_id ?? "—"}</p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand mb-2">
                VM Identities
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Kali", value: pod.vmid_kali },
                  { label: "Meta", value: pod.vmid_meta },
                  { label: "DVWA", value: pod.vmid_dvwa },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted px-2 py-1 rounded border border-border text-xs">
                    <span className="text-text-muted mr-1">{label}:</span>
                    <code className="text-text-main font-mono">{value ?? "—"}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {confirming && (
        <DestroyPodConfirmation
          podId={podId}
          isOpen={confirming}
          onCancel={() => setConfirming(false)}
          onConfirm={handleConfirmDestroy}
        />
      )}
    </LayoutWrapper>
  );
}
