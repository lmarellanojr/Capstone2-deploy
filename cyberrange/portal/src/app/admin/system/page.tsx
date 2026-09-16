"use client";

import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, MockDataNotice } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { mockCapacity, mockServiceStatus } from "@/lib/mock/adminMock";

const SERVICE_BADGE: Record<string, "success" | "warning" | "danger"> = {
  healthy: "success",
  degraded: "warning",
  down: "danger",
};

export default function AdminSystemPage() {
  const podPct = Math.round((mockCapacity.podsInUse / mockCapacity.podsCapacity) * 100);
  const storagePct = Math.round((mockCapacity.storageUsedGb / mockCapacity.storageCapacityGb) * 100);

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">System Health</h1>
          <p className="text-text-muted mt-1">Service status and capacity across the range</p>
        </div>
        <MockDataNotice />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-surface p-6">
          <h2 className="text-lg font-bold text-text-main mb-4">Pod Capacity</h2>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-text-muted">In use</span>
            <span className="font-semibold text-text-main">
              {mockCapacity.podsInUse} / {mockCapacity.podsCapacity}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-brand" style={{ width: `${podPct}%` }} />
          </div>
        </div>

        <div className="card-surface p-6">
          <h2 className="text-lg font-bold text-text-main mb-4">Storage Capacity</h2>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-text-muted">Used</span>
            <span className="font-semibold text-text-main">
              {mockCapacity.storageUsedGb} GB / {mockCapacity.storageCapacityGb} GB
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-brand" style={{ width: `${storagePct}%` }} />
          </div>
        </div>
      </div>

      <div className="card-surface p-6">
        <h2 className="text-lg font-bold text-text-main mb-4">Service Status</h2>
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
        <h2 className="text-lg font-bold text-text-main mb-2">Audit Information</h2>
        <p className="text-sm text-text-muted">
          Real service/host telemetry and audit log entries are pending the Pod/API Contract
          Audit (P0-01), which classifies which admin endpoints already exist vs. need to be
          built.
        </p>
      </div>
    </LayoutWrapper>
  );
}
