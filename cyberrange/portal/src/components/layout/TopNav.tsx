"use client";

import { signOut, useSession } from "next-auth/react";
import { useState } from "react";
import { Logo } from "./Logo";

interface TopNavProps {
  onSearch?: (query: string) => void;
  showLogo?: boolean;
}

export function TopNav({ onSearch, showLogo = false }: TopNavProps) {
  const { data: session } = useSession();
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <header className="bg-secondary border-b border-border h-16 flex items-center justify-between px-4 sm:px-6 shadow-card">
      {showLogo && (
        <div className="lg:hidden mr-4">
          <Logo size="sm" />
        </div>
      )}

      <div className="flex-1 max-w-lg">
        <input
          type="text"
          placeholder="Search labs..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            onSearch?.(e.target.value);
          }}
          className="w-full bg-muted border border-border rounded-lg px-4 py-2 text-sm text-text-main placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
        />
      </div>

      <div className="flex items-center gap-4 ml-4">
        <button
          className="relative text-text-muted hover:text-text-main transition p-2"
          aria-label="Notifications"
        >
          <span className="text-lg">🔔</span>
          <span className="absolute top-1 right-1 h-2 w-2 bg-brand rounded-full" />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition border border-transparent hover:border-border"
          >
            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm">
              {session?.user?.name?.charAt(0).toUpperCase() || "S"}
            </div>
            <span className="text-text-main font-semibold text-sm hidden md:inline max-w-[120px] truncate">
              {session?.user?.name || "Student"}
            </span>
            <span className="text-text-muted text-xs">▼</span>
          </button>

          {showDropdown && (
            <div className="absolute top-full right-0 mt-2 w-52 bg-secondary border border-border rounded-lg shadow-card-hover overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <p className="text-xs text-text-muted">Signed in as</p>
                <p className="text-text-main font-semibold text-sm truncate">
                  {session?.user?.email}
                </p>
              </div>
              <button
                onClick={() => {
                  signOut({ callbackUrl: "/api/auth/federated-logout" });
                  setShowDropdown(false);
                }}
                className="w-full text-left px-4 py-3 text-danger hover:bg-muted transition text-sm font-medium"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}