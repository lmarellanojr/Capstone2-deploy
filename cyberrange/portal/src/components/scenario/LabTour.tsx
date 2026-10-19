"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** The lab surface a scenario runs on, as returned by getLabSurface(). */
type Surface = "terminal" | "dvwa" | "siem";

export interface LabTourStep {
  /** Value of the `data-tour` attribute on the element this step points at. */
  target: string;
  title: string;
  body: React.ReactNode;
}

/** First-run steps, anchored to stable `data-tour` hooks on the lab page. */
export function labTourSteps(surface: Surface): LabTourStep[] {
  const labStep: LabTourStep =
    surface === "dvwa"
      ? {
          target: "lab-surface",
          title: "DVWA opens here",
          body: (
            <>
              Log in with <code className="px-1 rounded bg-muted">admin</code> /{" "}
              <code className="px-1 rounded bg-muted">password</code>, then set{" "}
              <strong>DVWA Security</strong> to <strong>Low</strong> before your first payload.
            </>
          ),
        }
      : {
          target: "lab-surface",
          title: "Your console is already connected",
          body: (
            <>
              Click inside the terminal and type — there is nothing to log in to. If there are
              tabs above it, they switch between machines.
            </>
          ),
        };

  return [
    {
      target: "task-panel",
      title: "Your first task is here",
      body: (
        <>
          Read the instructions, then do the work in the lab. Hints and the full walkthrough are
          further down this panel if you get stuck.
        </>
      ),
    },
    labStep,
    {
      target: "task-status",
      title: "Watch for the ✓",
      body: (
        <>
          Steps score automatically a few seconds after they work. When one scores, a ✓ appears
          here and you move to the next task.
        </>
      ),
    },
    {
      target: "lab-help",
      title: "Stuck? Help is here",
      body: (
        <>
          <strong>Troubleshooting</strong> has quick fixes for common problems. Replay this tour
          any time with the <strong>?</strong> button.
        </>
      ),
    },
  ];
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 12;
const MARGIN = 16;

/**
 * Where to put the card so it does not cover the element it points at: below,
 * above, right, then left of the anchor. When none fits — on phones, a stacked
 * pane can fill the whole screen — it pins to the viewport edge farther from
 * the anchor's centre and may overlap the pane; there is nowhere else to go.
 */
export function placeCard(
  anchor: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number }
): { top: number; left: number } {
  const clampLeft = (x: number) =>
    Math.max(MARGIN, Math.min(x, viewport.width - card.width - MARGIN));
  const clampTop = (y: number) =>
    Math.max(MARGIN, Math.min(y, viewport.height - card.height - MARGIN));
  const bottom = anchor.top + anchor.height;
  const right = anchor.left + anchor.width;

  if (bottom + GAP + card.height <= viewport.height - MARGIN) {
    return { top: bottom + GAP, left: clampLeft(anchor.left) };
  }
  if (anchor.top - GAP - card.height >= MARGIN) {
    return { top: anchor.top - GAP - card.height, left: clampLeft(anchor.left) };
  }
  if (right + GAP + card.width <= viewport.width - MARGIN) {
    return { top: clampTop(anchor.top), left: right + GAP };
  }
  if (anchor.left - GAP - card.width >= MARGIN) {
    return { top: clampTop(anchor.top), left: anchor.left - GAP - card.width };
  }
  const anchorCentre = anchor.top + anchor.height / 2;
  return {
    top: anchorCentre > viewport.height / 2 ? MARGIN : viewport.height - card.height - MARGIN,
    left: clampLeft(viewport.width - card.width - MARGIN),
  };
}

/** The part of the anchor actually on screen, so placement uses what is visible. */
export function visibleBox(anchor: Box, viewport: { width: number; height: number }): Box | null {
  const top = Math.max(anchor.top, 0);
  const left = Math.max(anchor.left, 0);
  const bottom = Math.min(anchor.top + anchor.height, viewport.height);
  const right = Math.min(anchor.left + anchor.width, viewport.width);
  if (bottom <= top || right <= left) return null;
  return { top, left, width: right - left, height: bottom - top };
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

function findTarget(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
}

interface LabTourProps {
  open: boolean;
  onClose: () => void;
  surface: Surface;
  /**
   * Move focus into the card when it opens. Off for the automatic first-run
   * start so a student already typing in the terminal keeps their focus.
   */
  focusOnOpen?: boolean;
}

/**
 * Non-blocking coach marks: a ring around the live element and a small card
 * beside it. There is no backdrop, so the lab stays usable while it is open,
 * and it sits below modals (z-40) so a dialog always wins.
 */
export function LabTour({ open, onClose, surface, focusOnOpen = true }: LabTourProps) {
  const steps = labTourSteps(surface);
  const [index, setIndex] = useState(0);
  const [anchor, setAnchor] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  useEffect(() => {
    if (open) {
      setIndex(0);
      navigatedRef.current = false;
    }
  }, [open]);

  // Hand focus back to wherever it was (e.g. the terminal) when the tour closes.
  // A layout effect declared before the one below, so it records focus before
  // the heading takes it.
  useLayoutEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  const measure = useCallback(() => {
    const el = findTarget(step.target);
    const card = cardRef.current;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const rect = el?.getBoundingClientRect();
    const box = rect
      ? visibleBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height }, viewport)
      : null;
    const size = { width: card?.offsetWidth ?? 320, height: card?.offsetHeight ?? 160 };
    const next = box
      ? placeCard(box, size, viewport)
      : { top: viewport.height - size.height - MARGIN, left: viewport.width - size.width - MARGIN };
    // Keep the previous objects when nothing moved, so a scroll that doesn't
    // move the anchor (e.g. terminal output) doesn't re-render the tour.
    setAnchor((prev) => (sameBox(prev, box) ? prev : box));
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [step.target]);

  // At most one measure per animation frame while scrolling or resizing.
  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    if (!open) return;
    findTarget(step.target)?.scrollIntoView?.({ block: "nearest" });
    measure();
    if (focusOnOpen || navigatedRef.current) headingRef.current?.focus();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [open, step.target, measure, scheduleMeasure, focusOnOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A dialog on top owns Escape, and Escape typed elsewhere (vim/less in
      // the terminal) isn't meant for the tour.
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!cardRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {anchor && (
        <div
          aria-hidden="true"
          data-testid="lab-tour-ring"
          className="fixed z-40 pointer-events-none rounded-xl ring-2 ring-brand ring-offset-2 ring-offset-transparent transition-all"
          style={{ top: anchor.top, left: anchor.left, width: anchor.width, height: anchor.height }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="lab-tour-title"
        data-testid="lab-tour-card"
        data-step-target={step.target}
        className="fixed z-40 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-secondary p-4 shadow-card"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h2
            id="lab-tour-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-bold text-text-main outline-none"
          >
            {step.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close walkthrough"
            className="shrink-0 rounded text-text-muted hover:text-text-main focus-ring"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">{step.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-muted tabular-nums">
            {index + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => {
                  navigatedRef.current = true;
                  setIndex((i) => i - 1);
                }}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-text-muted hover:text-text-main focus-ring"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) return onClose();
                navigatedRef.current = true;
                setIndex((i) => i + 1);
              }}
              className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90 focus-ring"
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
