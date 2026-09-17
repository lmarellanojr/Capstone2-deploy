"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import type { Role } from "next-auth";
import { LoadingSpinner } from "@/components/ui";
import { hasRequiredRole } from "@/lib/routeRoles";

interface AuthGateProps {
  children: React.ReactNode;
  /** AUTH-04: e.g. ["instructor", "admin"]. Omit for sections open to any authenticated role. */
  requiredRoles?: Role[];
}

/**
 * Redirects to /login (preserving the current path as callbackUrl) when unauthenticated,
 * and shows a spinner while session status is still resolving. Used by section layouts
 * (e.g. instructor, admin) so individual pages don't each repeat this check.
 *
 * middleware.ts is the actual enforcement point for requiredRoles (it runs before this
 * component ever renders); this is a client-side backstop for the same check, e.g. a role
 * revoked mid-session before the next full navigation re-runs middleware.
 */
export function AuthGate({ children, requiredRoles }: AuthGateProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
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
