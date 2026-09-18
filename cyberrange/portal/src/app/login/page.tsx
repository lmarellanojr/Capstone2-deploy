"use client";

import { signIn, useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui";

// AUTH-05: one role per account (confirmed by Lenie + Leonardo — no multi-role,
// no self-signup), so this is a plain lookup, not a priority order. Returns
// null when the account has none of the three app roles, which routes to
// /no-role instead of any portal.
function landingPathForRole(roles: string[] | undefined): string | null {
  if (roles?.includes("admin")) return "/admin";
  if (roles?.includes("instructor")) return "/instructor";
  if (roles?.includes("student")) return "/dashboard";
  return null;
}

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const explicitCallbackUrl = searchParams.get("callbackUrl");
  const error = searchParams.get("error");

  useEffect(() => {
    if (status !== "authenticated" || error === "SessionExpired") return;
    // No-role check always wins, even over an explicit callbackUrl -- a
    // no-role account must never land in a portal (task's own "Done when").
    const landingPath = landingPathForRole(session?.user?.roles);
    if (landingPath === null) {
      router.push("/no-role");
      return;
    }
    router.push(explicitCallbackUrl || landingPath);
  }, [status, router, explicitCallbackUrl, error, session]);

  const handleSignIn = async () => {
    setIsLoading(true);
    // Must redirect:true so browser navigates to Keycloak after state/pkce cookies are set.
    // redirect:false returned a URL but never navigated — broken OAuth start.
    // No role is known before OAuth completes, so a fresh sign-in with no
    // explicit target bounces back to /login itself; the effect above then
    // routes by the now-authenticated session.user.roles.
    await signIn("keycloak", { callbackUrl: explicitCallbackUrl || "/login", redirect: true });
  };

  if (status === "authenticated" && error !== "SessionExpired") {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary p-6">
      <div className="card-surface p-8 sm:p-10 max-w-md w-full">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <h1 className="text-2xl font-bold text-center text-text-main mb-1">Sign in</h1>
        <p className="text-text-muted text-center text-sm mb-8">
          Access your cybersecurity training labs
        </p>

        {error === "SessionExpired" && (
          <div className="mb-6 p-4 alert-error text-sm">
            <p className="font-semibold mb-1">Session Expired</p>
            <p>Your authentication token has expired. Please sign in again.</p>
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          onClick={handleSignIn}
          disabled={isLoading}
          loading={isLoading}
          className="w-full"
        >
          {isLoading ? "Signing in..." : "Continue with school SSO"}
        </Button>

        <p className="text-text-muted text-xs text-center mt-6">
          Secure authentication via Keycloak
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-primary">
          <div className="animate-spin h-10 w-10 border-2 border-border border-t-brand rounded-full" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
