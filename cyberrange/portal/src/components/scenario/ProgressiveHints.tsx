"use client";

import { useEffect, useState } from "react";
import { Check, Copy, HelpCircle, Lightbulb } from "lucide-react";
import { hintsForTask, type Hint } from "@/lib/scenarioHints";
import { injectPodIpsIntoGuide } from "@/lib/podIps";
import { copyToClipboard } from "@/lib/copyToClipboard";

interface ProgressiveHintsProps {
  scenarioId: string;
  milestoneId: number;
  /** When set, $TARGET_* placeholders in command hints become this pod's real addresses. */
  podId?: number;
  className?: string;
}

function CommandHint({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-slate-900 text-slate-100 text-xs leading-relaxed p-3 pr-10 font-mono whitespace-pre">
        {text}
      </pre>
      <button
        type="button"
        onClick={async () => setCopied(await copyToClipboard(text))}
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy"}
        className="absolute top-2 right-2 inline-flex items-center justify-center h-7 w-7 rounded-md bg-slate-700/80 text-slate-100 hover:bg-slate-600 focus-ring"
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

function HintCard({ hint, index, podId }: { hint: Hint; index: number; podId?: number }) {
  const isCommand = hint.kind === "command";
  const isExactStep = hint.kind !== "nudge";
  const text = isCommand && podId != null ? injectPodIpsIntoGuide(hint.text, podId) : hint.text;
  const note = hint.note;

  return (
    <li className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
          {isExactStep ? <Lightbulb size={12} aria-hidden="true" /> : <HelpCircle size={12} aria-hidden="true" />}
          {isExactStep ? "Exact step" : `Hint ${index + 1}`}
        </span>
      </div>
      {isCommand ? (
        <>
          <CommandHint text={text} />
          {note && <p className="mt-1.5 text-[11px] text-text-muted leading-relaxed">{note}</p>}
        </>
      ) : (
        <p className="text-sm text-text-main leading-relaxed">{text}</p>
      )}
    </li>
  );
}

/**
 * Per-task hints revealed one at a time: a nudge first, then the exact command.
 * Nothing is shown until the student chooses to reveal a hint, so the task is
 * not spoiled for those who don't want help.
 */
export function ProgressiveHints(props: ProgressiveHintsProps) {
  return <TaskHints key={`${props.scenarioId}:${props.milestoneId}`} {...props} />;
}

function TaskHints({ scenarioId, milestoneId, podId, className = "" }: ProgressiveHintsProps) {
  const hints = hintsForTask(scenarioId, milestoneId);
  const [revealed, setRevealed] = useState(0);

  if (hints.length === 0) return null;
  const remaining = hints.length - revealed;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Stuck? Reveal a hint</span>
        {revealed > 0 && (
          <span className="text-[11px] text-text-muted tabular-nums">
            {revealed} of {hints.length} shown
          </span>
        )}
      </div>

      {revealed > 0 && (
        <ul className="space-y-2">
          {hints.slice(0, revealed).map((hint, i) => (
            <HintCard key={i} hint={hint} index={i} podId={podId} />
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setRevealed((n) => Math.min(n + 1, hints.length))}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline rounded focus-ring"
        >
          <HelpCircle size={14} aria-hidden="true" />
          {revealed === 0
            ? hints.length === 1
              ? "Show a hint"
              : "Show a hint (nudge first)"
            : hints[revealed]?.kind !== "nudge"
              ? "Show the exact step"
              : "Show the next hint"}
        </button>
      )}
    </div>
  );
}
