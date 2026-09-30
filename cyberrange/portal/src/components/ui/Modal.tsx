"use client";

import React, { createContext, useContext, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Lets ModalHeader (or a custom heading) pick up the id the dialog is
// labelled by, without every caller threading an id through props.
const ModalTitleIdContext = createContext<string | undefined>(undefined);

/** The id to put on a custom dialog heading so screen readers announce it. */
export function useModalTitleId() {
  return useContext(ModalTitleIdContext);
}

type ModalSize = "md" | "lg" | "xl";

const sizeClasses: Record<ModalSize, string> = {
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-4xl",
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: ModalSize;
}

export function Modal({ isOpen, onClose, children, size = "md" }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Read through a ref so a parent re-render (new inline onClose) doesn't
  // re-run the effect and yank focus back to the first control.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initial =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    initial?.focus();

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

  return (
    <div
      className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4 animate-overlay-in"
      // mousedown, not click: a drag that starts inside the dialog (e.g.
      // selecting text) and ends on the backdrop must not close it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <ModalTitleIdContext.Provider value={titleId}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`relative bg-secondary border border-border rounded-2xl shadow-overlay w-full ${sizeClasses[size]} max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden focus:outline-none animate-dialog-in`}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-muted transition focus-ring"
            aria-label="Close modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
          {children}
        </div>
      </ModalTitleIdContext.Provider>
    </div>
  );
}

interface ModalHeaderProps {
  title: string;
  /** Kept for existing callers. The dialog's own close button (top-right) now
   *  handles dismissal, so a second one is no longer rendered here. */
  onClose?: () => void;
}

export function ModalHeader({ title }: ModalHeaderProps) {
  const titleId = useModalTitleId();
  return (
    <div className="border-b border-border px-5 sm:px-8 py-5 sm:py-6 pr-14 shrink-0">
      <h2 id={titleId} className="text-xl sm:text-2xl font-bold text-text-main">
        {title}
      </h2>
    </div>
  );
}

interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalBody({ children, className = "" }: ModalBodyProps) {
  return <div className={`px-5 sm:px-8 py-6 overflow-y-auto min-h-0 flex-1 ${className}`}>{children}</div>;
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalFooter({ children, className = "" }: ModalFooterProps) {
  return (
    <div
      className={`border-t border-border px-5 sm:px-8 py-4 flex flex-wrap justify-end gap-3 bg-muted/50 shrink-0 ${className}`}
    >
      {children}
    </div>
  );
}
