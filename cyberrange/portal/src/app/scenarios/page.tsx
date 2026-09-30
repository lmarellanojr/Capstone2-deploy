"use client";

import { useState } from "react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { ScenarioGrid } from "@/components/scenarios/ScenarioGrid";

export default function ScenariosPage() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <LayoutWrapper onSearch={setSearchQuery}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-text-main">My Labs</h1>
          <p className="text-text-muted mt-1">
            Work through the scenarios in order — each one builds on the last. Every lab runs in its own private
            environment.
          </p>
        </div>

        <ScenarioGrid searchQuery={searchQuery} />
      </div>
    </LayoutWrapper>
  );
}
