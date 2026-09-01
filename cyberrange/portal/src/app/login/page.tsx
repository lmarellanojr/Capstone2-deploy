"use client";

import { signIn, useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui";

type Role = "student" | "instructor" | "admin";

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState<Role>("student");
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const error = searchParams.get("error");

  useEffect(() => {
    if (status === "authenticated" && error !== "SessionExpired") {
      router.push(callbackUrl);
    }
  }, [status, router, callbackUrl, error]);

  const handleSignIn = async () => {
    setIsLoading(true);
    // Must redirect:true so browser navigates to Keycloak after state/pkce cookies are set.
    // redirect:false returned a URL but never navigated — broken OAuth start.
    await signIn("keycloak", { callbackUrl, redirect: true });
  };

  if (status === "authenticated" && error !== "SessionExpired") {
    return null;
  }

  const roles: { id: Role; label: string }[] = [
    { id: "student", label: "Student" },
    { id: "instructor", label: "Instructor" },
    { id: "admin", label: "Admin" },
  ];

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

        <div className="flex rounded-lg border border-border p-1 mb-6 bg-muted">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRole(r.id)}
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition ${
                role === r.id
                  ? "bg-secondary text-text-main shadow-card"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

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
          Secure authentication via Keycloak · Role: {role}
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