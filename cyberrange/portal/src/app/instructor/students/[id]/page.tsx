"use client";

import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, LoadingSpinner } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { useStudentProgress } from "@/hooks/useStudentProgress";

interface PageProps {
  params: { id: string };
}

function podBadgeVariant(status: string): "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "PROVISIONING" || status === "DESTROYING") return "warning";
  return "info";
}

function milestoneBadgeVariant(status: string): "success" | "danger" | "warning" {
  if (status === "PASS") return "success";
  if (status === "FAIL") return "danger";
  return "warning";
}

function reviewBadgeVariant(status: string): "success" | "danger" | "warning" | "info" {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "RETRY") return "info";
  return "warning";
}

export default function InstructorStudentDetailPage({ params }: PageProps) {
  const { id: studentId } = params;
  const { student, loading, error, forbidden, notFound } = useStudentProgress(studentId);

  if (forbidden) {
    return (
      <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
        <AccessDenied message="You need an instructor or admin role to view student progress." />
      </LayoutWrapper>
    );
  }

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
      <div className="mb-6">
        <Link href="/instructor/students" className="text-sm text-brand font-semibold hover:underline">
          ← Back to Students
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading student progress..." />
        </div>
      ) : notFound ? (
        <div className="card-surface p-10 text-center">
          <p className="text-lg font-semibold text-text-main mb-1">Student not found</p>
          <p className="text-text-muted text-sm">
            No pods, milestones, or reviews on record for &quot;{studentId}&quot;.
          </p>
        </div>
      ) : error ? (
        <div className="p-3 alert-error text-sm">
          <p>{error}</p>
        </div>
      ) : student ? (
        <>
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-text-main">{student.student_id}</h1>
            <p className="text-text-muted mt-1">Milestone progress, active pod, and review history</p>
            <p className="text-xs text-text-muted mt-1">
              Gap: no aggregate score field exists per student in the merged API. Milestones below
              list every verification attempt with its own detection score; review scores (0-100)
              are per review case.
            </p>
          </div>

          <div className="card-surface p-6 mb-6">
            <h2 className="text-lg font-bold text-text-main mb-4">Active Pod</h2>
            {student.active_pod ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-text-muted mb-0.5">Pod ID</p>
                  <p className="font-semibold text-text-main">{student.active_pod.pod_id}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-0.5">Status</p>
                  <Badge variant={podBadgeVariant(student.active_pod.status)}>{student.active_pod.status}</Badge>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-0.5">Scenario</p>
                  <p className="font-semibold text-text-main">{student.active_pod.scenario_id ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-0.5">Expires</p>
                  <p className="font-semibold text-text-main">
                    {student.active_pod.expires_at
                      ? new Date(student.active_pod.expires_at).toLocaleString()
                      : "—"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-text-muted text-sm">No active pod.</p>
            )}
          </div>

          <div className="card-surface overflow-hidden mb-6">
            <h2 className="text-lg font-bold text-text-main p-6 pb-4">Milestones (attempt history)</h2>
            {student.milestones.length === 0 ? (
              <p className="text-text-muted text-sm px-6 pb-6">No milestone activity yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                      <th className="py-3 px-6 font-semibold">Scenario</th>
                      <th className="py-3 px-4 font-semibold">Milestone</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">Detection Score</th>
                      <th className="py-3 px-4 font-semibold">Verified At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {student.milestones.map((m, idx) => (
                      <tr key={`${m.scenario_id}-${m.milestone_id}-${idx}`} className="border-b border-border last:border-0">
                        <td className="py-3 px-6 text-text-main">{m.scenario_id}</td>
                        <td className="py-3 px-4 text-text-muted">{m.milestone_id}</td>
                        <td className="py-3 px-4">
                          <Badge variant={milestoneBadgeVariant(m.status)}>{m.status}</Badge>
                        </td>
                        <td className="py-3 px-4 text-text-muted">{m.detection_score ?? "—"}</td>
                        <td className="py-3 px-4 text-text-muted">
                          {m.verified_at ? new Date(m.verified_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-surface overflow-hidden">
            <h2 className="text-lg font-bold text-text-main p-6 pb-4">Review History</h2>
            {student.reviews.length === 0 ? (
              <p className="text-text-muted text-sm px-6 pb-6">No review cases on record.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                      <th className="py-3 px-6 font-semibold">Scenario</th>
                      <th className="py-3 px-4 font-semibold">Type</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">Score</th>
                      <th className="py-3 px-4 font-semibold">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {student.reviews.map((r) => (
                      <tr key={r.review_id} className="border-b border-border last:border-0">
                        <td className="py-3 px-6 text-text-main">{r.scenario_id}</td>
                        <td className="py-3 px-4 text-text-muted">{r.case_type}</td>
                        <td className="py-3 px-4">
                          <Badge variant={reviewBadgeVariant(r.status)}>{r.status}</Badge>
                        </td>
                        <td className="py-3 px-4 text-text-muted">{r.score ?? "—"}</td>
                        <td className="py-3 px-4 text-text-muted">
                          {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </LayoutWrapper>
  );
}
