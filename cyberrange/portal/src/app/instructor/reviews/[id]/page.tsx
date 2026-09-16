"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, Button, MockDataNotice } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { mockReviewQueue } from "@/lib/mock/instructorMock";

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "info"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  retry: "info",
};

export default function ReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const reviewCase = mockReviewQueue.find((c) => c.id === params.id);

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor">
      <div className="mb-6">
        <Link href="/instructor/reviews" className="text-sm text-brand font-semibold hover:underline">
          ← Back to Review Queue
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main font-mono">{params.id}</h1>
          <p className="text-text-muted mt-1">
            {reviewCase ? `${reviewCase.student} · ${reviewCase.scenario} · ${reviewCase.milestone}` : "Case not found in mock data"}
          </p>
        </div>
        <MockDataNotice />
      </div>

      {reviewCase && (
        <div className="mb-6">
          <Badge variant={STATUS_BADGE[reviewCase.status]}>{reviewCase.status}</Badge>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card-surface p-6">
            <h2 className="text-lg font-bold text-text-main mb-3">Milestone Attempt</h2>
            <p className="text-sm text-text-muted">
              Placeholder for the submitted report text, command history, and scoring evidence tied to this
              milestone attempt. Populated once DB-01 (review_cases) and the scoring/evidence API are available.
            </p>
          </div>

          <div className="card-surface p-6">
            <h2 className="text-lg font-bold text-text-main mb-3">Evidence</h2>
            <div className="border border-dashed border-border rounded-lg p-8 text-center text-text-muted text-sm">
              Evidence attachments (screenshots, logs, terminal capture) will render here.
            </div>
          </div>

          <div className="card-surface p-6">
            <h2 className="text-lg font-bold text-text-main mb-3">Instructor Notes</h2>
            <textarea
              disabled
              placeholder="Notes are read-only in this shell — wiring up later."
              className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-text-muted placeholder-text-muted resize-none"
              rows={4}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="card-surface p-6">
            <h2 className="text-lg font-bold text-text-main mb-4">Decision</h2>
            <div className="space-y-3">
              <Button variant="success" className="w-full" disabled title="Coming soon — needs review API">
                Approve
              </Button>
              <Button variant="danger" className="w-full" disabled title="Coming soon — needs review API">
                Reject
              </Button>
              <Button variant="outline" className="w-full" disabled title="Coming soon — needs review API">
                Request Retry
              </Button>
            </div>
            <p className="text-xs text-text-muted mt-3">
              Disabled for UI-01: approve/reject/retry requires the review API and instructor role guard.
            </p>
          </div>

          <div className="card-surface p-6">
            <h2 className="text-lg font-bold text-text-main mb-3">Scores</h2>
            <p className="text-sm text-text-muted">Scoring breakdown placeholder.</p>
          </div>
        </div>
      </div>
    </LayoutWrapper>
  );
}
