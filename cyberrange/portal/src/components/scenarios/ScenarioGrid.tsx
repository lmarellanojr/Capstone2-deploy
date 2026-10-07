"use client";

import { useMemo } from "react";
import { SearchX } from "lucide-react";
import { ScenarioCard } from "./ScenarioCard";
import { OrientationCard } from "./OrientationCard";
import { useScenarios } from "@/hooks/useScenarios";
import { useScenarioProgress } from "@/hooks/useScenarioProgress";
import { LoadingSpinner } from "@/components/ui";
import { progressStatus, recommendedScenarioId, scenarioTotalPoints } from "@/lib/scenarioProgress";

interface ScenarioGridProps {
  /** From the top-bar search box. */
  searchQuery?: string;
}

export function ScenarioGrid({ searchQuery = "" }: ScenarioGridProps) {
  const scenarios = useScenarios();
  const earned = useScenarioProgress();

  const ordered = useMemo(() => [...scenarios].sort((a, b) => a.displayNumber - b.displayNumber), [scenarios]);

  const filtered = useMemo(() => {
    if (!searchQuery) return ordered;
    const query = searchQuery.toLowerCase();
    return ordered.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.mitre.toLowerCase().includes(query)
    );
  }, [ordered, searchQuery]);

  const showOrientation = useMemo(() => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      "orientation".includes(q) ||
      "start".includes(q) ||
      "scenario 0".includes(q) ||
      "welcome".includes(q)
    );
  }, [searchQuery]);

  const recommended = recommendedScenarioId(scenarios, earned);

  if (!scenarios.length) {
    return <LoadingSpinner message="Loading scenarios..." />;
  }

  if (filtered.length === 0 && !showOrientation) {
    return (
      <div className="text-center py-14 px-6 card-surface border-dashed" aria-live="polite">
        <SearchX size={32} className="mx-auto mb-3 text-text-faint" aria-hidden="true" />
        <p className="text-text-main font-semibold">No labs match “{searchQuery}”</p>
        <p className="text-text-muted text-sm mt-1">Try another word, or clear the search box above.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {showOrientation && <OrientationCard />}
      {filtered.map((scenario) => {
        const total = scenarioTotalPoints(scenario);
        const got = earned?.[scenario.id] ?? 0;
        return (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            progress={earned === null ? undefined : { status: progressStatus(got, total), earned: got, total }}
            recommended={scenario.id === recommended}
          />
        );
      })}
    </div>
  );
}
