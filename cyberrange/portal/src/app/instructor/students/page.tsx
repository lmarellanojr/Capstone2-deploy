"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { LoadingSpinner, MockDataNotice } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { mockStudents } from "@/lib/mock/instructorMock";

export default function InstructorStudentsPage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/instructor/students");
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
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Students</h1>
          <p className="text-text-muted mt-1">Roster, progress, and pod status</p>
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
                <th className="py-3 px-4 font-semibold">Progress</th>
                <th className="py-3 px-4 font-semibold">Active Pod</th>
                <th className="py-3 px-4 font-semibold">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {mockStudents.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="py-3 px-4 font-semibold text-text-main">{s.name}</td>
                  <td className="py-3 px-4 text-text-muted">{s.email}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-brand" style={{ width: `${s.progress}%` }} />
                      </div>
                      <span className="text-text-muted text-xs">{s.progress}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-text-muted font-mono text-xs">{s.activePod ?? "—"}</td>
                  <td className="py-3 px-4 text-text-muted">{s.lastActivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutWrapper>
  );
}
