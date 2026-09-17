"use client";

import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, LoadingSpinner } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { useInstructorStudents } from "@/hooks/useInstructorStudents";

function podBadgeVariant(status: string): "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "PROVISIONING" || status === "DESTROYING") return "warning";
  return "info";
}

export default function InstructorStudentsPage() {
  const { students, loading, error, forbidden } = useInstructorStudents();

  if (forbidden) {
    return (
      <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
        <AccessDenied message="You need an instructor or admin role to view the student roster." />
      </LayoutWrapper>
    );
  }

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-main">Students</h1>
          <p className="text-text-muted mt-1">Roster, milestone progress, and pod status</p>
          <p className="text-xs text-text-muted mt-1">
            Gap: the merged API has no aggregate score or attempt-count field per student — each
            milestone row below is one verification attempt with its own detection score.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 alert-error text-sm">
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner message="Loading students..." />
        </div>
      ) : students.length === 0 ? (
        <div className="card-surface p-10 text-center">
          <p className="text-text-muted text-sm">No students found yet.</p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th className="py-3 px-4 font-semibold">Student ID</th>
                  <th className="py-3 px-4 font-semibold">Passed / Attempts</th>
                  <th className="py-3 px-4 font-semibold">Active Pod</th>
                  <th className="py-3 px-4 font-semibold">Pending Reviews</th>
                  <th className="py-3 px-4 font-semibold">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const passed = s.milestones.filter((m) => m.status === "PASS").length;
                  const lastActivity = s.milestones[0]?.verified_at ?? s.active_pod?.last_heartbeat ?? null;
                  return (
                    <tr
                      key={s.student_id}
                      className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <Link
                          href={`/instructor/students/${encodeURIComponent(s.student_id)}`}
                          className="font-semibold text-text-main hover:text-brand hover:underline"
                        >
                          {s.student_id}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-text-muted">
                        {passed} / {s.milestones.length}
                      </td>
                      <td className="py-3 px-4">
                        {s.active_pod ? (
                          <Badge variant={podBadgeVariant(s.active_pod.status)}>
                            {s.active_pod.status} · pod {s.active_pod.pod_id}
                          </Badge>
                        ) : (
                          <span className="text-text-muted font-mono text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {s.pending_review_count > 0 ? (
                          <Badge variant="warning">{s.pending_review_count}</Badge>
                        ) : (
                          <span className="text-text-muted text-xs">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-text-muted">
                        {lastActivity ? new Date(lastActivity).toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </LayoutWrapper>
  );
}
