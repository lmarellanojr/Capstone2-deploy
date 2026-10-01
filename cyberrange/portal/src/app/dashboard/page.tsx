"use client";

import { useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { PodStatus } from "@/components/provisioning/PodStatus";
import { MyVerificationRequests } from "@/components/reviews/MyVerificationRequests";
import { Badge } from "@/components/ui";
import { useScenarios, scenarioDisplayTitle } from "@/hooks/useScenarios";
import { useScenarioProgress } from "@/hooks/useScenarioProgress";
import type { Pod } from "@/lib/api";

// Starting a lab has exactly one path now: My Labs → a scenario → Start Lab.
// The old dashboard "Provision New Pod" wizard duplicated that flow in
// operator vocabulary; ProvisioningOverlay stays in the codebase, just not
// on the student dashboard.

const HOW_IT_WORKS = [
  "Pick a lab from My Labs.",
  "Read the Big Picture, then click Let’s Go — your private lab starts in about a minute.",
  "Work through the tasks in the terminal. Points are detected automatically as you go.",
  "End the session when you’re done. Your score is always saved.",
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const scenarios = useScenarios();
  const [pods, setPods] = useState<Pod[]>([]);
  // scenarioId -> points earned; null until the first /progress response.
  const earnedByScenario = useScenarioProgress();

  const handlePodsChange = useCallback((next: Pod[]) => {
    setPods(next);
  }, []);

  const firstName = session?.user?.name?.split(" ")[0] || "Student";
  const totalPoints = scenarios.reduce(
    (sum, s) => sum + s.milestones.reduce((m, x) => m + x.points, 0),
    0
  );
  const earned =
    earnedByScenario === null ? null : Object.values(earnedByScenario).reduce((a, b) => a + b, 0);

  const liveScenarioIds = useMemo(
    () =>
      new Set(
        pods
          .filter((p) => p.status === "ACTIVE" || p.status === "PROVISIONING")
          .map((p) => (p.scenario_id != null ? String(p.scenario_id).padStart(2, "0") : ""))
      ),
    [pods]
  );

  const stats = [
    { label: "Labs available", value: String(scenarios.length) },
    {
      label: "Points earned",
      value: earned === null ? "…" : earned.toLocaleString(),
      detail: `of ${totalPoints.toLocaleString()}`,
      accent: true,
    },
    { label: "Active sessions", value: String(liveScenarioIds.size) },
  ];

  return (
    <LayoutWrapper>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-text-main">Welcome back, {firstName}</h1>
          <p className="text-text-muted mt-1">Pick up where you left off.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {stats.map((stat) => (
            <div key={stat.label} className="card-surface p-6">
              <p className="text-sm text-text-muted">{stat.label}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                <span className={stat.accent ? "text-brand" : "text-text-main"}>{stat.value}</span>
                {stat.detail && earned !== null && (
                  <span className="ml-1.5 text-base font-medium text-text-muted">{stat.detail}</span>
                )}
              </p>
            </div>
          ))}
        </div>

        <section className="card-surface p-6 mb-8" aria-labelledby="continue-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="continue-heading" className="text-lg font-bold text-text-main">
              Continue learning
            </h2>
            <Link href="/scenarios" className="text-sm text-brand font-semibold hover:underline rounded focus-ring">
              View all labs →
            </Link>
          </div>
          <div className="space-y-3">
            {scenarios.map((s) => {
              const total = s.milestones.reduce((m, x) => m + x.points, 0);
              const got = earnedByScenario?.[s.id] ?? 0;
              const live = liveScenarioIds.has(s.id);
              const loaded = earnedByScenario !== null;
              const done = loaded && got >= total;
              const progressText = !loaded
                ? `${total} pts`
                : done
                  ? `${total} pts`
                  : got > 0
                    ? `In progress · ${got} / ${total} pts`
                    : `Not started · ${total} pts`;
              const cta = live ? "Resume lab" : done ? "Review" : got > 0 ? "Continue" : "Start";
              return (
                <Link
                  key={s.id}
                  href={`/scenario/${s.id}`}
                  className="group flex items-center justify-between gap-4 p-4 rounded-xl border border-border card-interactive"
                >
                  <div className="min-w-0">
                    {/* GUIDE-UX-TRIAL / SCEN-UX #116: same "Scenario N" number
                        as the catalog card and lab pages. */}
                    <p className="font-semibold text-text-main text-sm sm:text-base">{scenarioDisplayTitle(s)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      {live && (
                        <Badge variant="success" dot>
                          Session active
                        </Badge>
                      )}
                      {done && (
                        <Badge variant="success" dot>
                          Completed
                        </Badge>
                      )}
                      <span>{progressText}</span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand whitespace-nowrap">
                    {cta}
                    <ArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <MyVerificationRequests />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PodStatus
              onConnect={(pod) => {
                if (pod.scenario_id) {
                  router.push(`/scenario/${String(pod.scenario_id).padStart(2, "0")}`);
                } else {
                  router.push("/scenarios");
                }
              }}
              onPodsChange={handlePodsChange}
            />
          </div>

          <section className="card-surface p-6" aria-labelledby="how-heading">
            <h2 id="how-heading" className="text-lg font-bold text-text-main mb-4">
              How labs work
            </h2>
            <ol className="space-y-4">
              {HOW_IT_WORKS.map((step, i) => (
                <li key={step} className="flex gap-3 text-sm text-text-secondary">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </LayoutWrapper>
  );
}
