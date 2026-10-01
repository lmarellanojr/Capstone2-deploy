"use client";

import Link from "next/link";
import { RefreshCw, Server } from "lucide-react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, Button, LoadingSpinner } from "@/components/ui";
import { LabCountdown } from "@/components/scenario/LabCountdown";
import { instructorNavItems } from "@/lib/navigation";
import { useInstructorPods } from "@/hooks/useInstructorPods";
import { SCENARIOS } from "@/hooks/useScenarios";
import { formatScenarioName } from "@/lib/scenarioLabels";
import { formatSqliteDate } from "@/lib/sqliteTime";
import type { InstructorPodWithProgress } from "@/lib/api";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  RUNNING: { label: "Active", variant: "success" },
  PROVISIONING: { label: "Starting", variant: "warning" },
  DESTROYING: { label: "Ending", variant: "default" },
};

function progress(pod: InstructorPodWithProgress) {
  const sid = pod.scenario_id != null ? String(pod.scenario_id).padStart(2, "0") : "";
  const scenario = SCENARIOS.find((s) => s.id === sid);
  if (!scenario) return null;
  const passed = new Set(pod.milestones.filter((m) => m.status === "PASS").map((m) => m.milestone_id));
  const done = scenario.milestones.filter((m) => passed.has(m.id));
  return {
    done: done.length,
    total: scenario.milestones.length,
    points: done.reduce((sum, m) => sum + m.points, 0),
    maxPoints: scenario.milestones.reduce((sum, m) => sum + m.points, 0),
  };
}

// GAP-02: GET /instructor/pods — who is in a lab right now, and how far along.
// Refreshes every 30s (useInstructorPods); read-only by design: ending a pod
// stays an Admin operation.
export default function InstructorPodsPage() {
  const { pods, loading, error, forbidden, fetchedAtMs, refresh } = useInstructorPods();

  if (forbidden) {
    return (
      <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
        <AccessDenied message="You need an instructor or admin role to view live labs." />
      </LayoutWrapper>
    );
  }

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-text-main">Live labs</h1>
          <p className="text-text-muted mt-1">Students with a lab running right now, and their progress.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {error && (
        <div role="alert" className="mb-4 p-3 alert-error text-sm">
          {error}
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {loading && pods.length === 0 ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner message="Loading live labs…" />
          </div>
        ) : pods.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <Server size={28} className="mx-auto mb-3 text-text-faint" aria-hidden="true" />
            <p className="font-semibold text-text-main">No labs running right now</p>
            <p className="text-sm text-text-muted mt-1">When a student starts a lab it appears here within 30 seconds.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th scope="col" className="py-3 px-4 font-semibold">Student</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Scenario</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Status</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Progress</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Started</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Time left</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((pod) => {
                  const status = STATUS[pod.status] ?? { label: pod.status, variant: "danger" as const };
                  const p = progress(pod);
                  const pct = p && p.maxPoints > 0 ? Math.round((p.points / p.maxPoints) * 100) : 0;
                  return (
                    <tr key={pod.pod_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4">
                        <Link
                          href={`/instructor/students/${encodeURIComponent(pod.student_id)}`}
                          className="font-semibold text-brand hover:underline rounded focus-ring"
                        >
                          {pod.student_id}
                        </Link>
                        <p className="text-xs text-text-muted">Pod {pod.pod_id}</p>
                      </td>
                      <td className="py-3 px-4 text-text-main">{formatScenarioName(pod.scenario_id)}</td>
                      <td className="py-3 px-4">
                        <Badge variant={status.variant} dot>
                          {status.label}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 min-w-[10rem]">
                        {p ? (
                          <>
                            <p className="text-xs text-text-muted mb-1 tabular-nums">
                              {p.done} of {p.total} tasks · {p.points} / {p.maxPoints} pts
                            </p>
                            <div
                              className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
                              role="progressbar"
                              aria-label={`${pod.student_id} progress`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={pct}
                            >
                              <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                            </div>
                          </>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-text-muted whitespace-nowrap">{formatSqliteDate(pod.created_at)}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {pod.status === "ACTIVE" && pod.expires_at ? (
                          <LabCountdown remainingSeconds={pod.remaining_seconds} fetchedAtMs={fetchedAtMs} />
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </LayoutWrapper>
  );
}
