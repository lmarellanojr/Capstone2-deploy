"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import type { NavItem } from "@/lib/navigation";

interface LayoutWrapperProps {
  children: React.ReactNode;
  onSearch?: (query: string) => void;
  /** Passed through to Sidebar so Instructor/Admin shells can reuse this same shell with their own nav. */
  navItems?: NavItem[];
  sectionLabel?: string;
  /** Explicit, independent of sectionLabel: a section can have its own sidebar label
   *  without losing a working search box. Instructor/Admin pages set this themselves. */
  hideSearch?: boolean;
  /** When true, the persistent desktop sidebar column is not rendered, and
   *  `children` reclaims its width. Mobile overlay nav is unaffected. */
  hideSidebar?: boolean;
}

export function LayoutWrapper({ children, onSearch, navItems, sectionLabel, hideSearch = false, hideSidebar = false }: LayoutWrapperProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="flex h-screen min-h-[100dvh] bg-primary overflow-hidden">
      {!hideSidebar && (
        <div className="hidden lg:block w-64 flex-shrink-0">
          <Sidebar navItems={navItems} sectionLabel={sectionLabel} />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <TopNav
          onSearch={onSearch}
          showLogo
          onMenuClick={() => setMenuOpen(true)}
          hideSearch={hideSearch}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="p-3 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} aria-label="Close navigation menu" />
          <div className="relative w-64 max-w-[85vw] h-full">
            <Sidebar navItems={navItems} sectionLabel={sectionLabel} />
            <button type="button" onClick={() => setMenuOpen(false)} className="absolute top-4 right-3 p-2 rounded-lg bg-secondary text-text-main hover:bg-muted" aria-label="Close navigation menu">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
