"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export interface UserRowMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Starts a new group with a divider above it. */
  separated?: boolean;
}

/** Admin → Users "⋯" menu for the less-used row actions, so the table stays
 *  narrow. Positioned `fixed` because the table wrapper scrolls horizontally
 *  and would clip an absolutely-positioned menu on the last rows. */
export function UserRowMenu({
  label,
  items,
  note,
  disabled,
}: {
  label: string;
  items: UserRowMenuItem[];
  /** Muted, non-interactive line at the bottom (e.g. why an action is missing). */
  note?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed" });
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  };

  // Place under the button, or above it when there's no room below.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const below = window.innerHeight - r.bottom;
    setStyle(
      below < menuHeight + 12 && r.top > below
        ? { position: "fixed", right, bottom: window.innerHeight - r.top + 4 }
        : { position: "fixed", right, top: r.bottom + 4 }
    );
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onMove = () => close(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") close(false);
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next]?.focus({ preventScroll: true });
  };

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-muted transition focus-ring disabled:opacity-50"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={style}
          className="w-60 bg-secondary border border-border rounded-xl shadow-overlay overflow-hidden z-50 py-1 text-left"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separated && <div className="my-1 border-t border-border" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // Refocus ⋯ first so the dialog returns focus here when it closes.
                  close(true);
                  item.onSelect();
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-main hover:bg-muted focus:outline-none focus-visible:bg-muted"
              >
                {item.icon}
                {item.label}
              </button>
            </div>
          ))}
          {note && (
            <p className="mt-1 border-t border-border px-4 py-2 text-xs text-text-muted whitespace-normal">{note}</p>
          )}
        </div>
      )}
    </div>
  );
}
