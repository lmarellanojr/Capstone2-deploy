"use client";

import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, MockDataNotice } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { mockReviewQueue, mockStudents } from "@/lib/mock/instructorMock";

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "info"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  retry: "info",
};

export default function InstructorDashboardPage() {
  const pendingCount = mockReviewQueue.filter((c) => c.status === "pending" || c.status === "retry").length;
  const approvedToday = mockReviewQueue.filter((c) => c.status === "approved").length;
  const activePods = mockStudents.filter((s) => s.activePod).length;

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Instructor Dashboard</h1>
          <p className="text-text-muted mt-1">Route shell for review and student-progress tools</p>
        </div>
        <MockDataNotice />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Students", value: String(mockStudents.length) },
          { label: "Pending Reviews", value: String(pendingCount) },
          { label: "Active Pods", value: String(activePods) },
        ].map((stat) => (
          <div key={stat.label} className="card-surface p-6 text-center">
            <p className="text-3xl font-bold text-text-main">{stat.value}</p>
            <p className="text-sm text-text-muted mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="card-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text-main">Review Queue</h2>
          <Link href="/instructor/reviews" className="text-sm text-brand font-semibold hover:underline">
            View all reviews →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="py-2 pr-4 font-semibold">Case</th>
                <th className="py-2 pr-4 font-semibold">Student</th>
                <th className="py-2 pr-4 font-semibold">Scenario</th>
                <th className="py-2 pr-4 font-semibold">Submitted</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {mockReviewQueue.slice(0, 4).map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 font-mono text-text-main">{c.id}</td>
                  <td className="py-3 pr-4 text-text-main">{c.student}</td>
                  <td className="py-3 pr-4 text-text-muted">{c.scenario}</td>
                  <td className="py-3 pr-4 text-text-muted">{c.submitted}</td>
                  <td className="py-3 pr-4">
                    <Badge variant={STATUS_BADGE[c.status]}>{c.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <Link href="/instructor/students" className="card-surface p-6 hover:shadow-card-hover transition block">
          <h3 className="text-lg font-bold text-text-main mb-1">Students</h3>
          <p className="text-sm text-text-muted">Roster, progress, and per-student pod status.</p>
        </Link>
        <Link href="/instructor/reviews" className="card-surface p-6 hover:shadow-card-hover transition block">
          <h3 className="text-lg font-bold text-text-main mb-1">Reviews</h3>
          <p className="text-sm text-text-muted">Review queue, evidence, notes, approve/reject/retry.</p>
        </Link>
      </div>
    </LayoutWrapper>
  );
}
