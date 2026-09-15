"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, Button, LoadingSpinner, MockDataNotice } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { mockPods } from "@/lib/mock/adminMock";

const POD_BADGE: Record<string, "success" | "warning" | "info" | "danger" | "default"> = {
  active: "success",
  provisioning: "info",
  stopped: "default",
  destroying: "warning",
  failed: "danger",
};

export default function AdminPodsPage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/admin/pods");
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

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Pods</h1>
          <p className="text-text-muted mt-1">All provisioned pods across students</p>
        </div>
        <MockDataNotice />
      </div>

      <div className="mb-6 alert-warning p-4 text-sm">
        List-all and force-destroy are not implemented in this shell. They depend on the
        Pod/API Contract Audit (P0-01) and the admin role guard (AUTH-02) landing first — no
        button below performs a real action.
      </div>

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
              {mockPods.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="py-3 px-4 font-mono text-text-main">{p.id}</td>
                  <td className="py-3 px-4 text-text-muted">{p.student}</td>
                  <td className="py-3 px-4 text-text-muted">{p.scenario}</td>
                  <td className="py-3 px-4">
                    <Badge variant={POD_BADGE[p.status]}>{p.status}</Badge>
                  </td>
                  <td className="py-3 px-4 text-text-muted">{p.created}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled title="Coming soon — needs P0-01 + AUTH-02">
                        Reset
                      </Button>
                      <Button size="sm" variant="danger" disabled title="Coming soon — needs P0-01 + AUTH-02">
                        Destroy
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutWrapper>
  );
}
