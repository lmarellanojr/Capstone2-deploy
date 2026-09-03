"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui";
import { Logo } from "./Logo";
import { useScenarios } from "@/hooks/useScenarios";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const scenarios = useScenarios();

  const isActive = (href: string) => pathname.startsWith(href);

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: "▦" },
    { href: "/scenarios", label: "My Labs", icon: "◎", badge: String(scenarios.length) },
    { href: "#", label: "Leaderboard", icon: "▲", disabled: true },
    { href: "#", label: "Learning Path", icon: "→", disabled: true },
    { href: "#", label: "Settings", icon: "⚙", disabled: true },
  ];

  return (
    <aside className="w-64 max-w-full bg-secondary border-r border-border h-screen min-h-[100dvh] flex flex-col shadow-card">
      <div className="p-6 border-b border-border">
        <Logo showSubtitle />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-6 space-y-1">
        {navItems.map((item) => {
          const active = !item.disabled && isActive(item.href);
          const className = `flex items-center justify-between px-4 py-3 rounded-lg transition text-sm ${
            item.disabled
              ? "text-text-muted/50 cursor-not-allowed"
              : active
              ? "bg-muted text-text-main font-semibold border-l-4 border-brand pl-3"
              : "text-text-main hover:bg-muted"
          }`;

          const inner = (
            <>
              <span className="flex items-center gap-3">
                <span className="text-base opacity-70">{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {item.badge && <Badge variant="brand">{item.badge}</Badge>}
              {item.disabled && (
                <span className="text-[10px] uppercase tracking-wide text-text-muted">Soon</span>
              )}
            </>
          );

          if (item.disabled) {
            return (
              <div key={item.label} className={className}>
                {inner}
              </div>
            );
          }

          return (
            <Link key={item.href} href={item.href} className={className}>
              {inner}
            </Link>
          );
        })}
      </nav>

      {session?.user && (
        <div className="border-t border-border p-4 bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm">
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
