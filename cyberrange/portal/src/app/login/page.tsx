"use client";

import { signIn, useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { ShieldCheck, Target, TerminalSquare } from "lucide-react";
import Image from "next/image";
import { Button, LoadingSpinner } from "@/components/ui";

// Left-panel selling points — what the platform actually is, for a first-time
// MMDC BSIT student landing here.
const HIGHLIGHTS = [
  { Icon: ShieldCheck, title: "Attacker & defender scenarios", body: "Play both sides — break in, then lock it down." },
  { Icon: TerminalSquare, title: "Real machines in your browser", body: "A live Kali box and targets, in a private lab only you can touch." },
  { Icon: Target, title: "Scored as you work", body: "Milestones are detected automatically, with points and progress." },
];

// Two lines on purpose: who it's for, then what it is.
function Tagline() {
  return (
    <>
      <span className="block">Built for MMDC Network &amp; Cybersecurity students.</span>
      <span className="block">A safe space to learn, practice, grow, and protect.</span>
    </>
  );
}

function BrandHero() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#14171C] text-white p-12 xl:p-16">
      {/* soft brand glow, decorative */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-brand/30 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-brand/20 blur-3xl" />

      <div className="relative flex items-center gap-3">
        {/* White chip: the shield's navy half disappears on the dark panel. */}
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm" aria-hidden="true">
          <Image src="/mmdc-shield.png" alt="" width={37} height={32} priority />
        </div>
        <div className="leading-tight">
          <p className="font-bold">MMDC Cyber Range</p>
          <p className="text-xs text-white/60">Training Platform</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <h2 className="text-3xl xl:text-4xl font-bold leading-tight">Learn cybersecurity by doing.</h2>
        <p className="mt-4 text-white/70 leading-relaxed">
          Hands-on labs in a private environment — attack, defend, and watch your progress scored in real time.
        </p>
        <ul className="mt-10 space-y-6">
          {HIGHLIGHTS.map(({ Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Icon size={20} className="text-white" aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-white/60">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative max-w-md text-sm leading-relaxed text-white/60"><Tagline /></p>
    </div>
  );
}
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
      // displaying "Entering Cyber Range..." until the browser unloads, preventing a brief flicker
      // back to "Enter Cyber Range".
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
    <div className="min-h-screen lg:grid lg:grid-cols-2 bg-primary">
      <BrandHero />

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm text-center">
          {/* Official MMDC lockup above the form, centered on every screen size. */}
          <div className="flex justify-center mb-10">
            <Image
              src="/mmdc-logo.png"
              alt="Mapúa Malayan Digital College"
              width={800}
              height={694}
              className="h-24 w-auto"
              priority
            />
          </div>

          <h1 className="text-2xl font-bold text-text-main mb-1">Sign in to Cyber Range</h1>
          <p className="text-text-muted text-sm mb-8">Start your hands-on cybersecurity labs and challenges.</p>

          {error === "SessionExpired" && (
            <div role="alert" className="mb-6 p-4 alert-error text-sm text-left">
              <p className="font-semibold mb-1">Session Expired</p>
              <p>Your authentication token has expired. Please sign in again.</p>
            </div>
          )}

          {signInError && (
            <div role="alert" className="mb-6 p-4 alert-error text-sm text-left">
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
            {isLoading ? "Entering Cyber Range..." : "Enter Cyber Range"}
          </Button>

          <div className="mt-8 border-t border-border pt-5">
            <p className="text-text-muted text-xs">Secure login powered by Keycloak</p>
          </div>

          {/* The hero (and its tagline) is hidden on small screens. */}
          <p className="lg:hidden mt-8 text-center text-xs leading-relaxed text-text-muted"><Tagline /></p>
        </div>
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
