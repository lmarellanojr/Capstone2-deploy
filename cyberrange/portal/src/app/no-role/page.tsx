"use client";

import { signOut } from "next-auth/react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui";

// AUTH-05: authenticated Keycloak account with none of student/instructor/admin
// in session.user.roles lands here instead of any portal.
export default function NoRolePage() {
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
