"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Menu, Search } from "lucide-react";
import { Logo } from "./Logo";

interface TopNavProps {
  onSearch?: (query: string) => void;
  showLogo?: boolean;
  /** When true (active lab with sidebar hidden), keep the logo visible at lg+ too. */
  desktopBrand?: boolean;
  onMenuClick?: () => void;
  /** Instructor/Admin shells have no lab catalog to search — hide the box entirely there
   *  instead of rendering an input with no wired-up handler. */
  hideSearch?: boolean;
}

export function TopNav({
  onSearch,
  showLogo = false,
  desktopBrand = false,
  onMenuClick,
  hideSearch = false,
}: TopNavProps) {
  const { data: session } = useSession();
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const logoVisibility = desktopBrand ? "hidden sm:block" : "hidden sm:block lg:hidden";

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!showDropdown) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setShowDropdown(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowDropdown(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showDropdown]);

  return (
    <header className="bg-secondary border-b border-border min-h-16 flex items-center justify-between px-3 sm:px-6 py-2 gap-2">
      <button
        type="button"
        onClick={onMenuClick}
        className="lg:hidden shrink-0 p-2 rounded-lg text-text-main hover:bg-muted transition focus-ring"
        aria-label="Open navigation menu"
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {showLogo && (
        <Link
          href="/dashboard"
          aria-label="MMDC Cyber Range home"
          className={`${logoVisibility} mr-2 shrink-0`}
        >
          <Logo size="sm" />
        </Link>
      )}

      {!hideSearch && (
        <div className="flex-1 min-w-0 max-w-lg relative">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
          />
          <input
            type="search"
            aria-label="Search labs"
            placeholder="Search labs..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              onSearch?.(e.target.value);
            }}
            className="w-full bg-muted/60 border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-text-main placeholder:text-text-faint transition focus:outline-none focus:bg-secondary focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
          />
        </div>
      )}

      <div className="flex items-center gap-1 sm:gap-4 ml-auto shrink-0">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            aria-haspopup="menu"
            aria-expanded={showDropdown}
            aria-label="Account menu"
            className="flex items-center gap-1 sm:gap-2 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg hover:bg-muted transition border border-transparent hover:border-border focus-ring"
          >
            <div
              className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm"
              aria-hidden="true"
            >
              {session?.user?.name?.charAt(0).toUpperCase() || "S"}
            </div>
            <span className="text-text-main font-semibold text-sm hidden md:inline max-w-[120px] truncate">
              {session?.user?.name || "Student"}
            </span>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`text-text-muted transition-transform ${showDropdown ? "rotate-180" : ""}`}
            />
          </button>

          {showDropdown && (
            <div
              role="menu"
              className="absolute top-full right-0 mt-2 w-56 bg-secondary border border-border rounded-xl shadow-overlay overflow-hidden z-50 animate-dialog-in"
            >
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs text-text-muted">Signed in as</p>
                <p className="text-text-main font-semibold text-sm truncate">
                  {session?.user?.email}
                </p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // Straight to the logout route, not next-auth's signOut(): signOut
                  // deletes the session cookie first, and with it the id_token that
                  // lets Keycloak log out without a "Do you want to log out?" page.
                  // The route clears the session cookie itself.
                  setShowDropdown(false);
                  window.location.assign("/api/auth/federated-logout");
                }}
                className="w-full flex items-center gap-2 text-left px-4 py-3 text-danger hover:bg-muted transition text-sm font-medium focus:outline-none focus-visible:bg-muted"
              >
                <LogOut size={16} aria-hidden="true" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
