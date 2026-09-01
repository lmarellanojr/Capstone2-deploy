import Link from "next/link";
import { DifficultyBadge, scenarioDuration } from "./DifficultyBadge";
import { Button } from "@/components/ui";

interface Scenario {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  mitre: string;
  type?: string;
}

interface ScenarioCardProps {
  scenario: Scenario;
}

/** Capstone display order (portal ids stay 01/06/09/11). */
const CAPSTONE_LABEL: Record<string, string> = {
  '01': 'Scenario 1',
  '06': 'Scenario 2',
  '09': 'Scenario 3',
  '11': 'Scenario 4',
};

export function ScenarioCard({ scenario }: ScenarioCardProps) {
  const duration = scenarioDuration(scenario.difficulty);
  const capstone = CAPSTONE_LABEL[scenario.id] ?? `Lab ${scenario.id}`;

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