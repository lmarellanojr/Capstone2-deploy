import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Lightbulb,
  Rocket,
  Target,
  type LucideIcon,
} from "lucide-react";

// Turns the guides' plain blockquotes and bold-label lines into colour-coded,
// scannable callouts. Pure classification here (unit-tested); MarkdownView.tsx
// does the rendering. Colours are light-surface only — the Guide panel and the
// PDF export are always on a light background.

export type CalloutVariant = "teaching" | "warning" | "unlock" | "info" | "tip";

export interface CalloutStyle {
  /** border + background + text, applied to the card */
  container: string;
  /** icon colour */
  icon: string;
  Icon: LucideIcon;
  /** short screen-reader lead so the colour isn't the only signal */
  srLabel: string;
}

export const CALLOUT_STYLES: Record<CalloutVariant, CalloutStyle> = {
  // "What you're doing & why" — the concept behind the step.
  teaching: { container: "border-blue-300 bg-blue-50 text-blue-950", icon: "text-blue-500", Icon: Lightbulb, srLabel: "Concept" },
  // "Why exit matters", "Required", "Important" — don't-skip-this.
  warning: { container: "border-amber-300 bg-amber-50 text-amber-950", icon: "text-amber-600", Icon: AlertTriangle, srLabel: "Important" },
  // "What you can do with this" — what the step unlocks (motivational).
  unlock: { container: "border-emerald-300 bg-emerald-50 text-emerald-950", icon: "text-emerald-600", Icon: Rocket, srLabel: "What this unlocks" },
  // "Network", "Path", "Note", "Scoring detail" — reference facts.
  info: { container: "border-border bg-muted text-text-main", icon: "text-text-muted", Icon: Info, srLabel: "Note" },
  tip: { container: "border-brand/30 bg-brand/5 text-text-main", icon: "text-brand", Icon: Info, srLabel: "Tip" },
};

/** Classify a blockquote by the text it starts with (its bold label). */
export function classifyCallout(lead: string): CalloutVariant {
  const t = lead.trim().toLowerCase().replace(/[\s:]+$/, "");
  if (t.startsWith("what you're doing") || t.startsWith("what you are doing") || t.startsWith("what's happening")) return "teaching";
  if (t.startsWith("what you can do with this") || t.startsWith("what this unlocks")) return "unlock";
  if (
    t.startsWith("why") ||
    t.startsWith("required") ||
    t.startsWith("important") ||
    t.startsWith("warning") ||
    t.startsWith("careful") ||
    t.startsWith("heads up") ||
    t.startsWith("do not") ||
    t.startsWith("don't")
  )
    return "warning";
  if (t.startsWith("network") || t.startsWith("path") || t.startsWith("note") || t.startsWith("scoring")) return "info";
  return "tip";
}

// Action cues that appear as their own line, e.g. "**Goal:** ...". These are
// the three things a student scans for mid-lab: what to aim for, how to know
// it worked, what to do next.
export type CueKind = "goal" | "done" | "next";

export interface CueStyle {
  label: string;
  text: string;
  icon: string;
  Icon: LucideIcon;
}

export const CUE_STYLES: Record<CueKind, CueStyle> = {
  goal: { label: "Goal", text: "text-brand", icon: "text-brand", Icon: Target },
  done: { label: "Done when", text: "text-emerald-700", icon: "text-emerald-600", Icon: CheckCircle2 },
  next: { label: "Then", text: "text-brand", icon: "text-brand", Icon: ArrowRight },
};

/** Map a bold label like "Goal:" / "Done when:" / "Then:" to a cue, or null. */
export function classifyCue(label: string): CueKind | null {
  const t = label.trim().replace(/:$/, "").toLowerCase();
  if (t === "goal") return "goal";
  if (t === "done when" || t === "done") return "done";
  if (t === "then" || t === "next") return "next";
  return null;
}
