"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { CyberQuote } from "@/components/scenario/CyberQuote";
import type { Scenario } from "@/hooks/useScenarios";

// Student-facing names for the real provisioning stages. The step timing is
// an estimate (the API reports only PROVISIONING -> ACTIVE), so the last step
// simply stays "in progress" until the lab is actually ready — nothing here
// claims more precision than it has.
const STEPS = ["Creating your machines", "Connecting the network", "Linking the SIEM", "Opening your terminal"];
const STEP_DURATION_MS = 8_000;
// Past this, say so honestly instead of leaving the student wondering.
const SLOW_AFTER_S = 75;

function formatElapsed(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface ProvisioningViewProps {
  scenario?: Scenario;
  /** Re-open the "Before you start" overview while waiting. */
  onShowBigPicture?: () => void;
}

export function ProvisioningView({ scenario, onShowBigPicture }: ProvisioningViewProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setCurrentStep(0);
    const steps = setInterval(() => {
      setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, STEP_DURATION_MS);
    const clock = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      clearInterval(steps);
      clearInterval(clock);
    };
  }, []);

  const attacker = scenario?.type === "offensive";

  return (
    <div className="max-w-xl mx-auto w-full py-6 sm:py-10">
      <div className="card-surface overflow-hidden">
        <div className="h-1.5 bg-brand" aria-hidden="true" />
        <div className="p-6 sm:p-8">
          {scenario && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-xs font-bold uppercase tracking-widest text-brand">Scenario {scenario.displayNumber}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  attacker ? "bg-brand/10 text-brand" : "bg-blue-50 text-blue-800"
                }`}
              >
                {attacker ? "Attacker" : "Defender"}
              </span>
            </div>
          )}
          <h2 className="text-2xl font-bold text-text-main">Starting your lab</h2>
          <p className="mt-1 text-text-secondary">
            {scenario ? scenario.name : "Setting up a private environment just for you"}
          </p>

          {/* Announce step changes to screen readers; the ticking clock is
              visual only so it doesn't chatter every second. */}
          <p className="sr-only" role="status" aria-live="polite">
            Step {currentStep + 1} of {STEPS.length}: {STEPS[currentStep]}
          </p>

          <ol className="mt-6 space-y-3">
            {STEPS.map((label, i) => {
              const done = i < currentStep;
              const current = i === currentStep;
              return (
                <li key={label} className="flex items-center gap-3">
                  {done ? (
                    <CheckCircle2 size={20} className="shrink-0 text-success" aria-hidden="true" />
                  ) : current ? (
                    <Loader2 size={20} className="shrink-0 text-brand animate-spin" aria-hidden="true" />
                  ) : (
                    <Circle size={20} className="shrink-0 text-text-faint" aria-hidden="true" />
                  )}
                  <span
                    className={`text-sm ${
                      done ? "text-text-muted" : current ? "font-semibold text-text-main" : "text-text-faint"
                    }`}
                  >
                    {label}
                    {current && <span className="ml-2 text-xs font-normal text-brand">in progress…</span>}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
            <span className="text-text-muted">Usually takes 30–60 seconds</span>
            <span className="font-semibold tabular-nums text-text-main" aria-hidden="true">
              {formatElapsed(elapsed)}
            </span>
          </div>

          {elapsed >= SLOW_AFTER_S && (
            <div role="status" className="mt-4 alert-warning p-3 text-sm">
              Taking a bit longer than usual — the lab server may be busy. Keep this tab open; your lab will open
              automatically when it&apos;s ready.
            </div>
          )}
        </div>

        {scenario && (
          <div className="border-t border-border bg-primary/60 p-6 sm:p-8 space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-text-muted">While you wait</p>
            <CyberQuote scenarioId={scenario.id} />
            {onShowBigPicture && (
              <Button variant="secondary" size="sm" onClick={onShowBigPicture}>
                <Lightbulb size={15} className="text-brand" aria-hidden="true" />
                Re-read the Big Picture
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-text-muted">
        Keep this tab open — your lab opens automatically when it&apos;s ready.
      </p>
    </div>
  );
}
