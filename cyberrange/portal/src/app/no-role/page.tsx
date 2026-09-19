"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/layout/Logo";
import { Button, LoadingSpinner } from "@/components/ui";
import { landingPathForRole } from "@/lib/loginRouting";

// AUTH-05: authenticated Keycloak account with none of student/instructor/admin
// in session.user.roles lands here instead of any portal. /no-role is
// deliberately not in middleware.ts's matcher (it needs no specific role, just
// a session), so this page guards itself instead: review finding -- with no
// guard at all, an unauthenticated visitor saw "Your account signed in
// successfully" without ever signing in, and an account that DOES have a
// role could land here too (e.g. by typing the URL) and see an incorrect
// message.
export default function NoRolePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status === "authenticated") {
      const landingPath = landingPathForRole(session?.user?.roles);
      if (landingPath !== null) router.push(landingPath);
    }
  }, [status, session, router]);

  if (status !== "authenticated" || landingPathForRole(session?.user?.roles) !== null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary p-6">
      <div className="card-surface p-8 sm:p-10 max-w-md w-full text-center">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <h1 className="text-2xl font-bold text-text-main mb-2">No role assigned</h1>
        <p className="text-text-muted text-sm mb-8">
          Your account signed in successfully, but it has no student, instructor, or admin role
          yet. Contact your administrator to have a role assigned.
        </p>

        <Button
          variant="secondary"
          className="w-full"
          onClick={() => signOut({ callbackUrl: "/api/auth/federated-logout" })}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
