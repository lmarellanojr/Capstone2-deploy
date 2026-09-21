"use client";

import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, LoadingSpinner } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { useAdminPods } from "@/hooks/useAdminPods";
import { mockServiceStatus } from "@/lib/mock/adminMock";

const SERVICE_BADGE: Record<string, "success" | "warning" | "danger"> = {
  healthy: "success",
  degraded: "warning",
  down: "danger",
};

export default function AdminSystemPage() {
  const { capacity, loading, capacityError } = useAdminPods();

  const podPct = capacity && capacity.max_pods > 0
    ? Math.min(100, Math.round((capacity.active_pods / capacity.max_pods) * 100))
    : 0;

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">System Health</h1>
          <p className="text-text-muted mt-1">Service status and capacity across the range</p>
        </div>
      </div>

      {capacityError && (
        <div className="mb-6 p-4 alert-error rounded-lg">
          <p className="text-sm font-semibold">Capacity Telemetry Unavailable</p>
          <p className="text-xs mt-0.5">{capacityError}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading system telemetry..." />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Real Pod Capacity */}
          <div className="card-surface p-6">
            <h2 className="text-lg font-bold text-text-main mb-4">Pod Capacity</h2>
            {capacity ? (
              <>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-text-muted">In use</span>
                  <span className="font-semibold text-text-main">
                    {capacity.active_pods} / {capacity.max_pods} pods ({podPct}%)
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      podPct > 90 ? "bg-danger" : podPct > 75 ? "bg-warning" : "bg-brand"
                    }`}
                    style={{ width: `${podPct}%` }}
                  />
                </div>
                <div className="mt-3 flex justify-between text-xs text-text-muted">
                  <span>Profile: {capacity.profile}</span>
                  <span>Provisioning: {capacity.can_provision ? "Available" : "At Capacity"}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-text-muted">Capacity metrics currently unavailable.</p>
            )}
          </div>

          {/* Real Host Memory (RAM) */}
          <div className="card-surface p-6">
            <h2 className="text-lg font-bold text-text-main mb-4">Host Memory (RAM)</h2>
            {capacity && capacity.available_mb !== null ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Available Free RAM</span>
                  <span className="font-semibold text-text-main font-mono">
                    {Math.round(capacity.available_mb / 1024)} GB ({capacity.available_mb} MB)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">RAM Headroom per Pod</span>
                  <span className="font-mono text-text-main">
                    {capacity.ram_required_mb} MB ({capacity.pod_ram_mb} MB pod + {capacity.ram_buffer_mb} MB buffer)
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border text-xs">
                  <span className="text-text-muted">Admission Status</span>
                  <Badge variant={capacity.can_provision ? "success" : "danger"}>
                    {capacity.can_provision ? "Headroom Verified" : "Insufficient RAM"}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">Memory telemetry currently unavailable.</p>
            )}
          </div>
        </div>
      )}

      <div className="card-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-bold text-text-main">Service Status</h2>
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-text-muted border border-border">
            Fixture data
          </span>
        </div>
        <div className="space-y-3">
          {mockServiceStatus.map((svc) => (
            <div key={svc.name} className="flex items-center justify-between p-3 rounded-lg border border-border">
              <div>
                <p className="font-semibold text-text-main text-sm">{svc.name}</p>
                <p className="text-xs text-text-muted mt-0.5">{svc.detail}</p>
              </div>
              <Badge variant={SERVICE_BADGE[svc.status]}>{svc.status}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="card-surface p-6 mt-6">
        <h2 className="text-lg font-bold text-text-main mb-2">Audit & Telemetry Information</h2>
        <p className="text-sm text-text-muted">
          Range host memory and pod allocations are updated dynamically from the provisioning capacity engine. Service status entries are fixture data; live daemon health checks are not wired yet (tracked in P0-01).
        </p>
      </div>
    </LayoutWrapper>
  );
}
