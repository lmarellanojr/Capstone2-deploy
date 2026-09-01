"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { ScenarioGrid } from "@/components/scenarios/ScenarioGrid";
import { LoadingSpinner } from "@/components/ui";

type Category = "all" | "offensive" | "defensive";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All Labs" },
  { id: "offensive", label: "Offensive" },
  { id: "defensive", label: "Defensive" },
];

const DIFFICULTY_OPTIONS = [
  { level: 1, label: "Easy" },
  { level: 2, label: "Medium" },
  { level: 3, label: "Hard" },
];

export default function ScenariosPage() {
  const { status } = useSession();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [difficulties, setDifficulties] = useState<number[]>([]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/scenarios");
    }
  }, [status, router]);

  const toggleDifficulty = (level: number) => {
    setDifficulties((prev) =>
      prev.includes(level) ? prev.filter((d) => d !== level) : [...prev, level]
    );
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return (
    <LayoutWrapper onSearch={setSearchQuery}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-main">Lab Catalog</h1>
        <p className="text-text-muted mt-1">Browse and start cybersecurity training scenarios</p>
      </div>

      <div className="flex border-b border-border gap-1 mb-8 overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              category === cat.id
                ? "border-brand text-text-main"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="lg:w-56 flex-shrink-0">
          <div className="card-surface p-5">
            <h3 className="text-sm font-bold text-text-main mb-4">Filters</h3>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
              Difficulty
            </p>
            <div className="space-y-2">
              {DIFFICULTY_OPTIONS.map((opt) => (
                <label
                  key={opt.level}
                  className="flex items-center gap-2 text-sm text-text-main cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={difficulties.includes(opt.level)}
                    onChange={() => toggleDifficulty(opt.level)}
                    className="rounded border-border text-brand focus:ring-brand/30"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <ScenarioGrid
            searchQuery={searchQuery}
            category={category}
            difficulties={difficulties.length ? difficulties : undefined}
          />
        </div>
      </div>
    </LayoutWrapper>
  );
}