"use client";

import React, { useEffect, useRef } from "react";
import { AlertTriangle, LifeBuoy, X } from "lucide-react";

/** The lab surface a scenario runs on, as returned by getLabSurface(). */
type Surface = "terminal" | "dvwa" | "siem";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface TroubleshootingItem {
  problem: string;
  fix: React.ReactNode;
  /** Show only for these lab surfaces. Omit to show for all. */
  surfaces?: Surface[];
  /** Render as a warning rather than a plain entry. */
  warn?: boolean;
}

const ITEMS: TroubleshootingItem[] = [
  {
    problem: "The terminal stopped responding or went blank",
    fix: (
      <>
        <strong>Reload the page.</strong> Your lab session keeps running on the server, so reloading
        reconnects the terminal — you will not lose your progress or your remaining time.
      </>
    ),
    surfaces: ["terminal", "siem"],
  },
  {
    problem: "DVWA sent me back to the login page",
    fix: (
      <>
        Log in again with <code className="px-1 rounded bg-muted">admin</code> /{" "}
        <code className="px-1 rounded bg-muted">password</code>, set <strong>DVWA Security</strong> to{" "}
        <strong>Low</strong>, then submit your payload again.
      </>
    ),
    surfaces: ["dvwa"],
  },
  {
    problem: "My score did not update after a step that worked",
    fix: (
      <>
        Check that your <strong>active lab is the right scenario</strong>. If a banner appears on the
        page saying the score was not updated, follow it — usually it means starting this scenario
        again, then repeating the step.
      </>
    ),
  },
  {
    problem: 'A task stays "Pending" after the command finished',
    fix: (
      <>
        Press <strong>Enter</strong> once in the shell and wait a few seconds. Still pending? Use{" "}
        <strong>Manual Check</strong> (one per task); if it cannot confirm your work, the task goes to
        your instructor for review.
      </>
    ),
    surfaces: ["terminal", "siem"],
  },
  {
    problem: '"Reset score" — what it does',
    fix: (
      <>
        Resetting a scenario <strong>permanently deletes the points you earned there</strong> and
        starts a fresh attempt. You are asked to confirm first, so it never happens on a single
        accidental click.
      </>
    ),
    warn: true,
  },
];

interface TroubleshootingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  surface: Surface;
}

/**
 * A slide-over drawer listing common lab problems and their fixes, so students
 * can self-serve instead of concluding they did something wrong (SUS Q2, Q4,
 * Q8). Items are filtered to the current lab surface.
 */
export function TroubleshootingDrawer({ isOpen, onClose, surface }: TroubleshootingDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const items = ITEMS.filter((item) => !item.surfaces || item.surfaces.includes(surface));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex justify-end animate-overlay-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="troubleshooting-title"
        tabIndex={-1}
        className="relative h-full w-full max-w-md bg-secondary border-l border-border shadow-overlay flex flex-col focus:outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <h2 id="troubleshooting-title" className="flex items-center gap-2 text-lg font-bold text-text-main">
            <LifeBuoy size={20} className="text-brand" aria-hidden="true" />
            Troubleshooting
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-autofocus
            aria-label="Close troubleshooting"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-muted transition focus-ring"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-sm text-text-secondary">
            Common issues and how to fix them yourself. Your lab session keeps running while you read.
          </p>
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.problem}
                className={`rounded-xl border p-4 ${
                  item.warn ? "border-amber-200 bg-amber-50" : "border-border bg-muted/40"
                }`}
              >
                <p className={`flex items-start gap-2 font-semibold ${item.warn ? "text-amber-900" : "text-text-main"}`}>
                  {item.warn && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />}
                  <span>{item.problem}</span>
                </p>
                <p className={`mt-1.5 text-sm leading-relaxed ${item.warn ? "text-amber-800" : "text-text-secondary"}`}>
                  {item.fix}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">
            Still stuck? Use <strong>Ask an instructor to check this task</strong> on the task, or contact
            your instructor.
          </p>
        </div>
      </div>
    </div>
  );
}
