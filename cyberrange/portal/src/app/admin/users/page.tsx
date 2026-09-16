"use client";

import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, MockDataNotice } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { mockUsers } from "@/lib/mock/adminMock";

const ROLE_BADGE: Record<string, "brand" | "info" | "default"> = {
  admin: "brand",
  instructor: "info",
  student: "default",
};

export default function AdminUsersPage() {
  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Users</h1>
          <p className="text-text-muted mt-1">Accounts and Keycloak role assignment</p>
        </div>
        <MockDataNotice />
      </div>

      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                <th className="py-3 px-4 font-semibold">Name</th>
                <th className="py-3 px-4 font-semibold">Email</th>
                <th className="py-3 px-4 font-semibold">Role</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {mockUsers.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="py-3 px-4 font-semibold text-text-main">{u.name}</td>
                  <td className="py-3 px-4 text-text-muted">{u.email}</td>
                  <td className="py-3 px-4">
                    <Badge variant={ROLE_BADGE[u.role]}>{u.role}</Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={u.status === "active" ? "success" : "danger"}>{u.status}</Badge>
                  </td>
                  <td className="py-3 px-4 text-text-muted">{u.lastLogin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutWrapper>
  );
}
