"use client";

import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, Button, LoadingSpinner } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { useAdminInfraHealth } from "@/hooks/useAdminInfraHealth";
import { badgeVariantForStatus, formatCheckedAt } from "@/lib/infraHealth";

export default function AdminDashboardPage() {
  const { data: infra, loading, error, refresh, checkedAt } = useAdminInfraHealth();
  const capacity = infra?.capacity ?? null;

  const snapshotReady = !loading || infra !== null;
  const capacityUnavailable = snapshotReady && capacity === null;

  const activePodsCount = capacity
    ? capacity.active_pods
    : capacityUnavailable
      ? "Unavailable"
      : "-";

  const podCapacityStr = capacity
    ? `${capacity.active_pods} / ${capacity.max_pods}`
    : capacityUnavailable
      ? "Unavailable"
      : "-";

  const availableRamStr =
    capacity?.available_mb !== null && capacity?.available_mb !== undefined
      ? `${Math.round(capacity.available_mb / 1024)} GB free`
      : capacityUnavailable
        ? "Unavailable"
        : "-";

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Admin Dashboard</h1>
          <p className="text-text-muted mt-1">Platform administration and range telemetry</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 alert-error text-sm">
          <p>{error}</p>
        </div>
      )}

      {loading && !infra ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading admin overview..." />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {[
            { label: "Active Pods", value: String(activePodsCount) },
            { label: "Pod Capacity", value: podCapacityStr },
            { label: "Host RAM", value: availableRamStr },
          ].map((stat) => (
            <div key={stat.label} className="card-surface p-6 text-center">
              <p className="text-2xl sm:text-3xl font-bold text-text-main whitespace-nowrap">{stat.value}</p>
              <p className="text-sm text-text-muted mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-bold text-text-main">Service Status</h2>
              {checkedAt && (
                <span className="text-xs text-text-muted">
                  checked {formatCheckedAt(checkedAt)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
                Refresh
              </Button>
              <Link href="/admin/system" className="text-sm text-brand font-semibold hover:underline">
                View system health →
              </Link>
            </div>
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

        <div className="space-y-6">
          <Link href="/admin/users" className="card-surface p-6 hover:shadow-card-hover transition block">
            <h3 className="text-lg font-bold text-text-main mb-1">Users</h3>
            <p className="text-sm text-text-muted">Accounts and role assignment.</p>
          </Link>
          <Link href="/admin/pods" className="card-surface p-6 hover:shadow-card-hover transition block">
            <h3 className="text-lg font-bold text-text-main mb-1">Pods</h3>
            <p className="text-sm text-text-muted">List, status, and lifecycle actions.</p>
          </Link>
        </div>
      </div>
    </LayoutWrapper>
  );
}
