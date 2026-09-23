"use client";

import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, Button, LoadingSpinner } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { useAdminInfraHealth } from "@/hooks/useAdminInfraHealth";
import { badgeVariantForStatus, formatCheckedAt } from "@/lib/infraHealth";

export default function AdminSystemPage() {
  const { data: infra, loading, error, refresh, checkedAt } = useAdminInfraHealth();
  const capacity = infra?.capacity ?? null;

  const podPct =
    capacity && capacity.max_pods > 0
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

      {error && (
        <div className="mb-6 p-4 alert-error rounded-lg">
          <p className="text-sm font-semibold">Service Health Unavailable</p>
          <p className="text-xs mt-0.5">{error}</p>
        </div>
      )}

      {loading && !infra ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading system telemetry..." />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-bold text-text-main">Service Status</h2>
            {checkedAt && (
              <span className="text-xs text-text-muted">
                checked {formatCheckedAt(checkedAt)}
              </span>
            )}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
        </div>
        {loading && !infra ? (
          <LoadingSpinner message="Loading service health..." />
        ) : (
          <div className="space-y-3">
            {(infra?.services ?? []).map((svc) => (
              <div key={svc.name} className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="font-semibold text-text-main text-sm">{svc.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">{svc.detail}</p>
                </div>
                <Badge variant={badgeVariantForStatus(svc.status)}>{svc.status}</Badge>
              </div>
            ))}
            {!loading && (infra?.services?.length ?? 0) === 0 && !error && (
              <p className="text-sm text-text-muted">No service rows to display.</p>
            )}
          </div>
        )}
      </div>

      <div className="card-surface p-6 mt-6">
        <h2 className="text-lg font-bold text-text-main mb-2">Audit & Telemetry Information</h2>
        <p className="text-sm text-text-muted">
          Capacity and API, LXD, Keycloak and Wazuh status come from one snapshot via{" "}
          <code className="text-xs">/admin/infra-health</code>. Keycloak is checked through the
          API&apos;s token introspection; Wazuh through the read-only scoring account.
        </p>
      </div>
    </LayoutWrapper>
  );
}
