"use client";

import { signIn, useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui";
import { landingPathForRole, shouldHonorCallbackUrl, resolveSameOriginPath } from "@/lib/loginRouting";

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
    // resolveSameOriginPath strips anything that isn't actually same-origin
    // (open-redirect guard, review finding) before shouldHonorCallbackUrl
    // ever sees it -- router.push only ever receives a validated path.
    const safeCallbackUrl = resolveSameOriginPath(explicitCallbackUrl, window.location.origin);
    const target =
      safeCallbackUrl && shouldHonorCallbackUrl(safeCallbackUrl, session?.user?.roles)
        ? safeCallbackUrl
        : landingPath;
    router.push(target);
  }, [status, router, explicitCallbackUrl, error, session]);

  const handleSignIn = async () => {
    setIsLoading(true);
    // Must redirect:true so browser navigates to Keycloak after state/pkce cookies are set.
    // redirect:false returned a URL but never navigated — broken OAuth start.
    //
    // Always return to /login itself (carrying the original target, if any,
    // as /login's own callbackUrl param) instead of handing NextAuth the raw
    // target directly. Review finding: passing an explicit callbackUrl
    // straight to signIn() let NextAuth redirect there after OAuth without
    // ever loading this page again, so the effect above -- and its role /
    // no-role routing -- never ran for that sign-in. Validated through the
    // same resolveSameOriginPath used above, so an off-site value can't even
    // get embedded into the round-trip in the first place.
    const safeCallbackUrl = resolveSameOriginPath(explicitCallbackUrl, window.location.origin);
    const returnTo = safeCallbackUrl
      ? `/login?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`
      : "/login";
    await signIn("keycloak", { callbackUrl: returnTo, redirect: true });
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
