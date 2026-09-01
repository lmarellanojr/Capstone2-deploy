"use client";

import { useMemo } from "react";
import { ScenarioCard } from "./ScenarioCard";
import { useScenarios } from "@/hooks/useScenarios";
import { LoadingSpinner } from "@/components/ui";

interface ScenarioGridProps {
  searchQuery?: string;
  category?: "all" | "offensive" | "defensive";
  difficulties?: number[];
}

export function ScenarioGrid({
  searchQuery = "",
  category = "all",
  difficulties,
}: ScenarioGridProps) {
  const scenarios = useScenarios();

  const filtered = useMemo(() => {
    let result = scenarios;

    if (category !== "all") {
      result = result.filter((s) => s.type === category);
    }

    if (difficulties && difficulties.length > 0) {
      result = result.filter((s) => difficulties.includes(s.difficulty));
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.mitre.toLowerCase().includes(query)
      );
    }

    return result;
  }, [scenarios, searchQuery, category, difficulties]);

  if (!scenarios.length) {
    return <LoadingSpinner message="Loading scenarios..." />;
  }

  return (
    <div>
      <p className="text-text-secondary text-sm mb-6">
        {filtered.length} of {scenarios.length} labs
      </p>

      {filtered.length === 0 ? (
        <div className="text-center py-16 card-surface rounded-xl">
          <p className="text-text-secondary text-lg">No labs match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} />
          ))}
        </div>
      )}
    </div>
  );
}