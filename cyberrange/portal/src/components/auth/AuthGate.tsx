"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { LoadingSpinner } from "@/components/ui";
import { requiredRolesForPath, hasRequiredRole } from "@/lib/routeRoles";

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Redirects to /login (preserving the current path as callbackUrl) when unauthenticated,
 * and shows a spinner while session status is still resolving. Used by section layouts
 * (e.g. instructor, admin) so individual pages don't each repeat this check.
 *
 * Required roles are derived from the current path via routeRoles.ts, the same source
 * middleware.ts reads -- no separate prop to keep in sync. middleware.ts is the actual
 * enforcement point (it runs before this component ever renders); this is a client-side
 * backstop for the same check -- also subject to the mid-session-revocation window
 * documented in middleware.ts (the session cookie's roles only get re-decoded near
 * access-token expiry, not the instant a role changes in Keycloak).
 */
export function AuthGate({ children }: AuthGateProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const requiredRoles = requiredRolesForPath(pathname);
  const forbidden =
    status === "authenticated" && !!requiredRoles && !hasRequiredRole(session?.user?.roles, requiredRoles);

  useEffect(() => {
    if (status === "unauthenticated") {
      const params = new URLSearchParams();
      params.set("callbackUrl", pathname);
      router.push(`/login?${params.toString()}`);
    } else if (forbidden) {
      router.push("/dashboard");
    }
  }, [status, forbidden, router, pathname]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  if (status === "unauthenticated" || forbidden) {
    return null;
  }

  return <>{children}</>;
}
