"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, LoadingSpinner, MockDataNotice } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { mockCapacity, mockPods, mockServiceStatus, mockUsers } from "@/lib/mock/adminMock";

const SERVICE_BADGE: Record<string, "success" | "warning" | "danger"> = {
  healthy: "success",
  degraded: "warning",
  down: "danger",
};

export default function AdminDashboardPage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/admin");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  const activePods = mockPods.filter((p) => p.status === "active").length;

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Admin Dashboard</h1>
          <p className="text-text-muted mt-1">Route shell for platform administration</p>
        </div>
        <MockDataNotice />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Users", value: String(mockUsers.length) },
          { label: "Active Pods", value: String(activePods) },
          { label: "Pod Capacity", value: `${mockCapacity.podsInUse}/${mockCapacity.podsCapacity}` },
          { label: "Storage Used", value: `${mockCapacity.storageUsedGb}/${mockCapacity.storageCapacityGb} GB` },
        ].map((stat) => (
          <div key={stat.label} className="card-surface p-6 text-center">
            <p className="text-2xl sm:text-3xl font-bold text-text-main whitespace-nowrap">{stat.value}</p>
            <p className="text-sm text-text-muted mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-text-main">Service Status</h2>
            <Link href="/admin/system" className="text-sm text-brand font-semibold hover:underline">
              View system health →
            </Link>
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

        <div className="space-y-6">
          <Link href="/admin/users" className="card-surface p-6 hover:shadow-card-hover transition block">
            <h3 className="text-lg font-bold text-text-main mb-1">Users</h3>
            <p className="text-sm text-text-muted">Accounts and roles.</p>
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
