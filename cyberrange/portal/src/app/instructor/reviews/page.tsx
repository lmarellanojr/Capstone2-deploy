"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { Badge, LoadingSpinner, MockDataNotice } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { mockReviewQueue } from "@/lib/mock/instructorMock";

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "info"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  retry: "info",
};

export default function InstructorReviewsPage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/instructor/reviews");
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
          <h1 className="text-3xl font-bold text-text-main">Review Queue</h1>
          <p className="text-text-muted mt-1">Milestone submissions awaiting instructor review</p>
        </div>
        <MockDataNotice />
      </div>

      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                <th className="py-3 px-4 font-semibold">Case</th>
                <th className="py-3 px-4 font-semibold">Student</th>
                <th className="py-3 px-4 font-semibold">Scenario / Milestone</th>
                <th className="py-3 px-4 font-semibold">Submitted</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mockReviewQueue.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="py-3 px-4">
                    <Link href={`/instructor/reviews/${c.id}`} className="font-mono text-brand hover:underline">
                      {c.id}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-text-main font-semibold">{c.student}</td>
                  <td className="py-3 px-4 text-text-muted">
                    {c.scenario} · {c.milestone}
                  </td>
                  <td className="py-3 px-4 text-text-muted">{c.submitted}</td>
                  <td className="py-3 px-4">
                    <Badge variant={STATUS_BADGE[c.status]}>{c.status}</Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/instructor/reviews/${c.id}`} className="text-sm text-brand font-semibold hover:underline">
                      Open →
                    </Link>
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
