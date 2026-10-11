"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { LoadingSpinner } from "@/components/ui";
import { redirectPathForRole } from "@/lib/routeRoles";

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Redirects to /login (preserving path and query as callbackUrl) when unauthenticated,
 * and shows a spinner while session status is still resolving. Used by section layouts
 * (e.g. instructor, admin) so individual pages don't each repeat this check.
 *
 * Required roles are derived from the current path via routeRoles.ts, the same source
 * middleware.ts reads -- no separate prop to keep in sync. middleware.ts is the actual
 * enforcement point (it runs before this component ever renders); this is a client-side
 * backstop for the same check -- also subject to the mid-session-revocation window
 * documented in middleware.ts (the session cookie's roles only get re-decoded near
 * access-token expiry, not the instant a role changes in Keycloak).
 *
 * Review finding (Leo, PR #83): a role-less authenticated account isn't just
 * "wrong role for this specific page" -- it has none of the three app roles
 * at all, so it goes to /no-role, not /dashboard (which is exactly the
 * portal such an account shouldn't see either).
 */
export function AuthGate({ children }: AuthGateProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const roles = session?.user?.roles;
  const redirectPath = status === "authenticated" ? redirectPathForRole(pathname, roles) : null;

  useEffect(() => {
    if (status === "unauthenticated") {
      const params = new URLSearchParams();
      // Match middleware's pathname + search callback without adding a
      // useSearchParams dependency to every protected section's rendering.
      params.set("callbackUrl", `${pathname}${window.location.search}`);
      router.push(`/login?${params.toString()}`);
    } else if (redirectPath) {
      router.replace(redirectPath);
    }
  }, [status, redirectPath, router, pathname]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  if (status === "unauthenticated" || redirectPath) {
    return null;
  }

  return <>{children}</>;
}
