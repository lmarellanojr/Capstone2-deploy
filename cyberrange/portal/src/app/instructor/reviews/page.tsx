"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, Button, LoadingSpinner } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { useInstructorReviews } from "@/hooks/useInstructorReviews";
import { formatScenarioName, formatMilestoneLabel } from "@/lib/scenarioLabels";

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

const TABS = [
  { id: "ALL", label: "All Reviews" },
  { id: "PENDING", label: "Pending" },
  { id: "APPROVED", label: "Approved" },
  { id: "REJECTED", label: "Rejected" },
  { id: "RETRY", label: "Retry Requested" },
] as const;

type TabId = (typeof TABS)[number]["id"];

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

export default function InstructorReviewsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("ALL");
  const statusFilter = activeTab === "ALL" ? undefined : activeTab;

  const { reviews, loading, error, forbidden, refresh } = useInstructorReviews({
    statusFilter,
  });

  if (forbidden) {
    return (
      <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
        <AccessDenied message="You need an instructor or admin role to view reviews." />
      </LayoutWrapper>
    );
  }

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Review Queue</h1>
          <p className="text-text-muted mt-1">Milestone submissions awaiting instructor review</p>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3 mb-6">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? "bg-brand text-white shadow-sm"
                  : "text-text-muted hover:text-text-main hover:bg-muted/40"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-6 p-4 alert-error rounded-lg flex items-center justify-between">
          <p className="text-sm">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner message="Loading review cases..." />
        </div>
      ) : error ? null : reviews.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-text-main font-semibold mb-1">No review cases found</p>
          <p className="text-text-muted text-sm">
            {activeTab === "ALL"
              ? "There are currently no review cases submitted by students."
              : `There are no review cases with status ${activeTab}.`}
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th className="py-3 px-4 font-semibold">Case</th>
                  <th className="py-3 px-4 font-semibold">Student</th>
                  <th className="py-3 px-4 font-semibold">Scenario / Milestone</th>
                  <th className="py-3 px-4 font-semibold">Type</th>
                  <th className="py-3 px-4 font-semibold">Submitted</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((c) => (
                  <tr key={c.review_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="py-3 px-4">
                      <Link
                        href={`/instructor/reviews/${c.review_id}`}
                        className="font-mono text-brand font-semibold hover:underline"
                      >
                        #{c.review_id}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-text-main font-semibold">{c.student_id}</td>
                    <td className="py-3 px-4 text-text-muted">
                      {formatScenarioName(c.scenario_id)} · {formatMilestoneLabel(c.milestone_id)}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-text-muted">{c.case_type}</td>
                    <td className="py-3 px-4 text-text-muted">{formatDate(c.created_at)}</td>
                    <td className="py-3 px-4">
                      <Badge variant={STATUS_BADGE[c.status.toUpperCase()] || "default"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/instructor/reviews/${c.review_id}`}
                        className="text-sm text-brand font-semibold hover:underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </LayoutWrapper>
  );
}
