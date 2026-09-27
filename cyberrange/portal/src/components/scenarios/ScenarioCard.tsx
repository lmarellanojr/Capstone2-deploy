import Link from "next/link";
import { DifficultyBadge, scenarioDuration } from "./DifficultyBadge";
import { Button } from "@/components/ui";

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
}

export function ScenarioCard({ scenario }: ScenarioCardProps) {
  const duration = scenarioDuration(scenario.difficulty);
  const capstone = `Scenario ${scenario.displayNumber}`;

  return (
    <div className="card-surface rounded-xl p-6 hover:shadow-card-hover transition h-full flex flex-col">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brand mb-1">{capstone}</p>
            <h3 className="text-lg font-bold text-text-main leading-snug">{scenario.name}</h3>
          </div>
          <DifficultyBadge difficulty={scenario.difficulty} />
        </div>
        <p className="text-xs text-text-secondary">{duration} · MITRE {scenario.mitre}</p>
      </div>

      <p className="text-text-secondary text-sm flex-1 mb-5 line-clamp-3">{scenario.description}</p>

      <div className="pt-4 border-t border-border">
        <Link href={`/scenario/${scenario.id}`}>
          <Button variant="primary" size="sm" className="w-full">
            Start Lab →
          </Button>
        </Link>
      </div>
    </div>
  );
}