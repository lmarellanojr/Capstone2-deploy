"use client";

import { signIn, useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Logo } from "@/components/layout/Logo";
import { Button, LoadingSpinner } from "@/components/ui";
import { landingPathForRole, shouldHonorCallbackUrl, resolveSameOriginPath } from "@/lib/loginRouting";

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const explicitCallbackUrl = searchParams.get("callbackUrl");
  const error = searchParams.get("error");
  // Computed every render (cheap, pure) so the effect below can depend on
  // this primitive string instead of the whole session object -- next-auth
  // gives session a new object identity on every refetch (e.g. window
  // focus) even when the roles are unchanged, which would otherwise re-run
  // the effect and call router.push again while /login is still mounted
  // (review finding, traced not observed).
  const landingPath = landingPathForRole(session?.user?.roles);

  useEffect(() => {
    if (status !== "authenticated" || error === "SessionExpired") return;
    // No-role check always wins, even over an explicit callbackUrl -- a
    // no-role account must never land in a portal (task's own "Done when").
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
    // session is intentionally not a dependency (see landingPath comment
    // above); landingPath is derived from the same session?.user?.roles in
    // this same render, so the session read inside this effect for
    // shouldHonorCallbackUrl is always consistent with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router, explicitCallbackUrl, error, landingPath]);

  const handleSignIn = async () => {
    setSignInError(null);
    setIsLoading(true);
    try {
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
      // Review finding (Leo, PR #100): On the success path, signIn initiates browser
      // navigation to Keycloak. Leaving isLoading true keeps the button disabled and
      // displaying "Logging in..." until the browser unloads, preventing a brief flicker
      // back to "Log in".
    } catch (err) {
      // Review finding (Leo, PR #100): Log dispatch errors so they are diagnosable in
      // devtools, display an inline error alert, and reset loading state so the user can retry.
      console.error("Login dispatch failed:", err);
      setSignInError("Unable to connect to authentication service. Please try again.");
      setIsLoading(false);
    }
  };

  if (status === "authenticated" && error !== "SessionExpired") {
    return null;
  }

  // Review finding (Leo, PR #83): every sign-in now returns to /login first
  // (see handleSignIn above), so there's a real window right after OAuth
  // completes where useSession() is still resolving the just-created
  // session -- with no loading state here, the sign-in card was visible and
  // clickable during it, and a click would start a second OAuth round trip.
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <LoadingSpinner message="Loading..." />
      </div>
    );
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

        {signInError && (
          <div className="mb-6 p-4 alert-error text-sm">
            <p className="font-semibold mb-1">Sign In Failed</p>
            <p>{signInError}</p>
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
          {isLoading ? "Logging in..." : "Log in"}
        </Button>

        <p className="text-text-muted text-xs text-center mt-6">
          Secure authentication via Keycloak demo accounts
        </p>
        <p className="text-text-muted text-[11px] text-center mt-1">
          Sign in with your assigned student, instructor, or admin credentials
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
