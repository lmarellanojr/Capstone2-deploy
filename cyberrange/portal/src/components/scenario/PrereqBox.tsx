"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, Terminal, Lightbulb } from "lucide-react";
import { prereqsForScenario, type PrereqItem } from "@/lib/scenarioPrereqs";

interface PrereqBoxProps {
  scenarioId: string;
  className?: string;
  /** Start expanded. Defaults to true so students see the prerequisites. */
  defaultOpen?: boolean;
}

function ItemList({ items }: { items: PrereqItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.term} className="text-sm leading-relaxed">
          <span className="font-semibold text-text-main">{item.term}</span>
          <span className="text-text-secondary"> — {item.blurb}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Before you start" box: the tools, commands and concepts a scenario assumes,
 * each with a one-line explanation. Targets SUS Q10 ("needed to learn a lot
 * before I could get going") by making the assumed knowledge explicit up front.
 */
export function PrereqBox({ scenarioId, className = "", defaultOpen = true }: PrereqBoxProps) {
  const prereqs = prereqsForScenario(scenarioId);
  const [open, setOpen] = useState(defaultOpen);
  if (!prereqs) return null;

  return (
    <section className={`card-surface overflow-hidden ${className}`} aria-labelledby="prereq-heading">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/40 transition focus-ring"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <BookOpen size={18} className="shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0">
            <span id="prereq-heading" className="block font-semibold text-text-main">
              Before you start — what this lab assumes
            </span>
            <span className="block text-xs text-text-muted">
              The tools and ideas used here, in one line each. New to them? The guide walks through every step.
            </span>
          </span>
        </span>
        {open ? (
          <ChevronUp size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
        ) : (
          <ChevronDown size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-border space-y-5">
          <p className="text-sm text-text-secondary leading-relaxed">{prereqs.intro}</p>

          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted mb-2.5">
              <Terminal size={14} aria-hidden="true" />
              Tools &amp; commands
            </h3>
            <ItemList items={prereqs.tools} />
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted mb-2.5">
              <Lightbulb size={14} aria-hidden="true" />
              Concepts
            </h3>
            <ItemList items={prereqs.concepts} />
          </div>
        </div>
      )}
    </section>
  );
}
