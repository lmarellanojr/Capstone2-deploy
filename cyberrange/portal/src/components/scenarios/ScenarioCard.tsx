import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Sparkles } from "lucide-react";
import { DifficultyBadge, scenarioDuration } from "./DifficultyBadge";
import { buttonClasses } from "@/components/ui";
import type { ProgressStatus } from "@/lib/scenarioProgress";

interface Scenario {
  id: string;
  // GUIDE-UX-TRIAL / SCEN-UX #116: single source of truth is
  // SCENARIOS[].displayNumber in useScenarios.ts -- this card no longer
  // keeps its own id -> "Scenario N" lookup table (that duplicate table was
  // exactly the source of the catalog/guide numbering mismatch found in
  // trial testing).
  displayNumber: number;
  name: string;
  description: string;
  difficulty: number;
  mitre: string;
  type?: string;
}

interface ScenarioCardProps {
  scenario: Scenario;
  /** Omitted while progress is loading: the card then shows no status row. */
  progress?: { status: ProgressStatus; earned: number; total: number };
  /** The lab this student should do next (first not-completed, in order). */
  recommended?: boolean;
}

const CTA: Record<ProgressStatus, string> = {
  "not-started": "Start lab",
  "in-progress": "Continue lab",
  completed: "Review lab",
};

export function ScenarioCard({ scenario, progress, recommended = false }: ScenarioCardProps) {
  const duration = scenarioDuration(scenario.difficulty);
  const role = scenario.type === "defensive" ? "Defensive" : "Offensive";
  const status = progress?.status ?? "not-started";
  const pct = progress && progress.total > 0 ? Math.round((progress.earned / progress.total) * 100) : 0;

  return (
    <article
      className={`card-surface card-interactive p-6 h-full flex flex-col ${
        recommended ? "ring-2 ring-brand/30 border-brand/40" : ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">Scenario {scenario.displayNumber}</p>
          {recommended && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-text-on-accent">
              <Sparkles size={11} aria-hidden="true" />
              Recommended next
            </span>
          )}
        </div>
        <DifficultyBadge difficulty={scenario.difficulty} />
      </div>
      <h3 className="text-lg font-bold text-text-main leading-snug">{scenario.name}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
        <Clock size={12} aria-hidden="true" />
        {duration} · {role}
      </p>

      <p className="text-text-secondary text-sm flex-1 mt-3 mb-4 line-clamp-3">{scenario.description}</p>

      {/* Where this student stands on this lab — the thing they actually
          need from the catalog, instead of filters. */}
      {progress && (
        <div className="mb-4">
          {status === "completed" ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
              <CheckCircle2 size={16} aria-hidden="true" />
              Completed · {progress.total} pts
            </p>
          ) : status === "in-progress" ? (
            <>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1.5">
                <span className="font-semibold text-text-main">In progress</span>
                <span className="tabular-nums">
                  {progress.earned} / {progress.total} pts
                </span>
              </div>
              <div
                className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-label={`Scenario ${scenario.displayNumber} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : (
            <p className="text-xs text-text-muted">Not started · {progress.total} pts to earn</p>
          )}
        </div>
      )}

      {/* A Link styled as a button — not <Link><Button/></Link>, which nests
          two interactive elements (invalid HTML, two tab stops). */}
      <Link
        href={`/scenario/${scenario.id}`}
        className={buttonClasses(status === "completed" ? "secondary" : "primary", "sm", "w-full")}
        aria-label={`${CTA[status]}: Scenario ${scenario.displayNumber} — ${scenario.name}`}
      >
        {CTA[status]}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </article>
  );
}
