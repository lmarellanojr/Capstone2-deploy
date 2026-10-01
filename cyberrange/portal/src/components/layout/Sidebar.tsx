"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui";
import { Logo } from "./Logo";
import { useScenarios } from "@/hooks/useScenarios";
import { studentNavItems, type NavItem } from "@/lib/navigation";

interface SidebarProps {
  /** Overrides the default Student nav. Instructor/Admin shells pass their own set. */
  navItems?: NavItem[];
  /** Small label under the logo (e.g. "Instructor", "Admin") so the shared shell reads as that section. */
  sectionLabel?: string;
}

export function Sidebar({ navItems, sectionLabel }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const scenarios = useScenarios();

  // Students see only destinations that work today. The old Leaderboard /
  // Learning Path / Settings placeholders were permanently disabled "Soon"
  // rows — dead ends that made the product look unfinished.
  const items = navItems ?? studentNavItems(scenarios.length);

  // Pick the longest matching href so a child route (e.g. /instructor/reviews/case-0142)
  // still activates its section item ("Reviews") without also lighting up an unrelated
  // sibling/parent that merely shares a string prefix.
  const activeHref = items.reduce<string | null>((best, item) => {
    if (item.disabled) return best;
    const matches = pathname === item.href || pathname.startsWith(item.href + "/");
    if (!matches) return best;
    return best === null || item.href.length > best.length ? item.href : best;
  }, null);

  const showBackToAdmin =
    !!session?.user?.roles?.includes("admin") && pathname !== "/admin" && !pathname.startsWith("/admin/");

  return (
    <aside className="w-64 max-w-full bg-secondary border-r border-border h-screen min-h-[100dvh] flex flex-col">
      <div className="px-6 py-5 border-b border-border">
        <Logo showSubtitle />
        {sectionLabel && (
          <span className="mt-3 inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-brand/10 text-brand border border-brand/20">
            {sectionLabel}
          </span>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-5 space-y-1">
        {items.map((item) => {
          const active = !item.disabled && item.href === activeHref;
          const Icon = item.icon;
          const className = `flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition text-sm focus-ring ${
            item.disabled
              ? "text-text-faint cursor-not-allowed"
              : active
              ? "bg-brand/10 text-brand font-semibold"
              : "text-text-main hover:bg-muted"
          }`;

          const inner = (
            <>
              <span className="flex items-center gap-3 min-w-0">
                <Icon size={18} aria-hidden="true" className={active ? "text-brand" : "text-text-muted"} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge && <Badge variant="brand">{item.badge}</Badge>}
            </>
          );

          if (item.disabled) {
            return (
              <div key={item.label} className={className} aria-disabled="true">
                {inner}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={className}
              aria-current={active ? "page" : undefined}
            >
              {inner}
            </Link>
          );
        })}
      </nav>

      {/* Admins who open the Instructor view need a way home. Gated on the
          session role (not added to instructorNavItems), so Instructors never
          see it and the SEC-02 "no Admin links for Instructors" check holds. */}
      {showBackToAdmin && (
        <div className="px-3 pb-3">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border text-sm font-medium text-text-main hover:bg-muted transition focus-ring"
          >
            <ArrowLeft size={18} aria-hidden="true" className="text-text-muted" />
            Back to Admin
          </Link>
        </div>
      )}

      {session?.user && (
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm shrink-0"
              aria-hidden="true"
            >
              {session.user.name?.charAt(0).toUpperCase() || "S"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-main truncate">
                {session.user.name || "Student"}
              </p>
              <p className="text-xs text-text-muted truncate">{session.user.email}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
