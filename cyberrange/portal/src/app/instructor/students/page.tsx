"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, LoadingSpinner } from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { useInstructorStudents } from "@/hooks/useInstructorStudents";
import { SCENARIOS } from "@/hooks/useScenarios";
import { podBadgeVariant } from "@/lib/instructorBadges";
import { parseSqliteUtc } from "@/lib/sqliteTime";
import {
  overallPassedAttempted,
  totalPointsEarned,
  touchedScenarioSummaries,
  type ScenarioProgressDetail,
} from "@/lib/instructorStudentProgress";

function statusVariant(status: string): "success" | "danger" | "default" {
  if (status === "PASS") return "success";
  if (status === "FAIL") return "danger";
  return "default";
}

function ScenarioChips({ chips }: { chips: ScenarioProgressDetail[] }) {
  if (chips.length === 0) {
    return <span className="text-text-muted text-xs">No attempts yet</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.scenarioId}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-text-main"
          title={`${c.name}: ${c.pointsEarned}/${c.pointsTotal} pts`}
        >
          <span className="font-semibold">{c.label.replace("Scenario ", "S")}</span>
          <span className="text-text-muted">
            {c.passed}/{c.total}
          </span>
          <span className="tabular-nums text-text-muted">· {c.pointsEarned} pts</span>
        </span>
      ))}
    </div>
  );
}

function ExpandedDetail({
  studentId,
  chips,
}: {
  studentId: string;
  chips: ScenarioProgressDetail[];
}) {
  if (chips.length === 0) {
    return <p className="text-sm text-text-muted">No milestone attempts recorded.</p>;
  }
  return (
    <div className="space-y-4">
      {chips.map((s) => (
        <div key={s.scenarioId}>
          <div className="flex flex-wrap items-baseline gap-2 mb-1">
            <p className="text-sm font-semibold text-text-main">
              {s.label} — {s.name}
            </p>
            <p className="text-xs text-text-muted">
              {s.passed}/{s.total} tasks · {s.pointsEarned}/{s.pointsTotal} pts
            </p>
          </div>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-left text-text-muted">
                <tr>
                  <th className="py-1.5 px-3 font-semibold">Task</th>
                  <th className="py-1.5 px-3 font-semibold">Status</th>
                  <th className="py-1.5 px-3 font-semibold">Points</th>
                  <th className="py-1.5 px-3 font-semibold">Detection</th>
                </tr>
              </thead>
              <tbody>
                {s.milestones.map((m) => (
                  <tr key={m.milestoneId} className="border-t border-border">
                    <td className="py-1.5 px-3 text-text-main">
                      M{m.milestoneId} · {m.name}
                    </td>
                    <td className="py-1.5 px-3">
                      <Badge variant={statusVariant(m.status)}>{m.status}</Badge>
                    </td>
                    <td className="py-1.5 px-3 tabular-nums text-text-muted">
                      {m.status === "PASS" ? m.points : 0}
                      <span className="text-text-muted"> / {m.points}</span>
                    </td>
                    <td className="py-1.5 px-3 tabular-nums text-text-muted">
                      {m.detectionScore == null ? "—" : m.detectionScore}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <Link
        href={`/instructor/students/${encodeURIComponent(studentId)}`}
        className="inline-block text-sm font-semibold text-brand hover:underline"
      >
        Open full student detail →
      </Link>
    </div>
  );
}

export default function InstructorStudentsPage() {
  const { students, loading, error, forbidden } = useInstructorStudents();
  const [openId, setOpenId] = useState<string | null>(null);

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
          <p className="text-text-muted mt-1">Roster, per-scenario progress, and pod status</p>
          <p className="text-xs text-text-muted mt-1">
            Progress chips show tasks passed and catalog points per scenario (same points the student
            dashboard uses). Expand a row for task-level detail.
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
      ) : error ? null : students.length === 0 ? (
        <div className="card-surface p-10 text-center">
          <p className="text-text-muted text-sm">No students found yet.</p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th className="py-3 px-3 font-semibold w-8" aria-label="Expand" />
                  <th className="py-3 px-4 font-semibold">Student ID</th>
                  <th className="py-3 px-4 font-semibold">Progress by scenario</th>
                  <th className="py-3 px-4 font-semibold">Points</th>
                  <th className="py-3 px-4 font-semibold">Active Pod</th>
                  <th className="py-3 px-4 font-semibold">Pending Reviews</th>
                  <th className="py-3 px-4 font-semibold">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const { passed, attempted } = overallPassedAttempted(s.milestones, SCENARIOS);
                  const chips = touchedScenarioSummaries(s.milestones, SCENARIOS);
                  const points = totalPointsEarned(s.milestones, SCENARIOS);
                  const lastActivity = s.milestones[0]?.verified_at ?? s.active_pod?.last_heartbeat ?? null;
                  const open = openId === s.student_id;
                  return (
                    <Fragment key={s.student_id}>
                      <tr className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            className="text-text-muted hover:text-brand"
                            aria-expanded={open}
                            aria-label={open ? `Collapse ${s.student_id}` : `Expand ${s.student_id}`}
                            onClick={() => setOpenId(open ? null : s.student_id)}
                          >
                            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/instructor/students/${encodeURIComponent(s.student_id)}`}
                            className="font-semibold text-text-main hover:text-brand hover:underline"
                          >
                            {s.student_id}
                          </Link>
                          <p className="text-[11px] text-text-muted mt-0.5">
                            {passed}/{attempted} distinct tasks passed
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <ScenarioChips chips={chips} />
                        </td>
                        <td className="py-3 px-4 tabular-nums font-semibold text-text-main">
                          {points}
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
                          {parseSqliteUtc(lastActivity)?.toLocaleString() ?? "—"}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border bg-muted/10">
                          <td />
                          <td colSpan={6} className="py-4 px-4">
                            <ExpandedDetail studentId={s.student_id} chips={chips} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
