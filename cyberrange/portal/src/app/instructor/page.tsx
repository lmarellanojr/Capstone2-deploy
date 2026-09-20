"use client";

import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, LoadingSpinner } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { useInstructorStudents } from "@/hooks/useInstructorStudents";
import { useInstructorReviews } from "@/hooks/useInstructorReviews";
import { formatScenarioName } from "@/lib/scenarioLabels";

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "info"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  RETRY: "info",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  retry: "info",
};

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime())
      ? dateStr
      : d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  } catch {
    return dateStr;
  }
}

export default function InstructorDashboardPage() {
  const {
    students,
    loading: studentsLoading,
    error: studentsError,
    forbidden: studentsForbidden,
  } = useInstructorStudents();

  const {
    reviews,
    loading: reviewsLoading,
    error: reviewsError,
    forbidden: reviewsForbidden,
  } = useInstructorReviews();

  if (studentsForbidden || reviewsForbidden) {
    return (
      <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
        <AccessDenied message="You need an instructor or admin role to view the dashboard." />
      </LayoutWrapper>
    );
  }

  const studentCount = students.length;
  const activePods = students.filter((s) => s.active_pod).length;
  const pendingReviewsCount = reviews.length > 0
    ? reviews.filter((r) => r.status.toUpperCase() === "PENDING").length
    : students.reduce((sum, s) => sum + s.pending_review_count, 0);

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Instructor Dashboard</h1>
          <p className="text-text-muted mt-1">Student roster and progress overview</p>
        </div>
      </div>

      {studentsError && (
        <div className="mb-4 p-3 alert-error text-sm">
          <p>{studentsError}</p>
        </div>
      )}

      {studentsLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading dashboard..." />
        </div>
      ) : studentsError ? null : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            { label: "Students", value: String(studentCount) },
            { label: "Pending Reviews", value: String(pendingReviewsCount) },
            { label: "Active Pods", value: String(activePods) },
          ].map((stat) => (
            <div key={stat.label} className="card-surface p-6 text-center">
              <p className="text-3xl font-bold text-text-main">{stat.value}</p>
              <p className="text-sm text-text-muted mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text-main">Review Queue</h2>
          <Link href="/instructor/reviews" className="text-sm text-brand font-semibold hover:underline">
            View all reviews →
          </Link>
        </div>

        {reviewsError && (
          <div className="mb-4 p-3 alert-error text-sm">
            <p>{reviewsError}</p>
          </div>
        )}

        {reviewsLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner size="sm" message="Loading reviews..." />
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm">
            No reviews in queue.
          </div>
        ) : (
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
                {reviews.slice(0, 5).map((c) => (
                  <tr key={c.review_id} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="py-3 pr-4 font-mono">
                      <Link
                        href={`/instructor/reviews/${c.review_id}`}
                        className="text-brand font-semibold hover:underline"
                      >
                        #{c.review_id}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-text-main font-medium">{c.student_id}</td>
                    <td className="py-3 pr-4 text-text-muted">{formatScenarioName(c.scenario_id)}</td>
                    <td className="py-3 pr-4 text-text-muted">{formatDate(c.created_at)}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={STATUS_BADGE[c.status.toUpperCase()] || "default"}>
                        {c.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
