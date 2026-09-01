"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { Suspense } from "react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    Configuration:
      "There is a problem with the server configuration. Check if your options are correct.",
    AccessDenied: "You do not have permission to sign in.",
    Verification: "The verification link has expired or has already been used.",
    Default: "An unexpected authentication error occurred.",
  };

  const message =
    error && errorMessages[error] ? errorMessages[error] : errorMessages.Default;

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4">
      <div className="max-w-md w-full card-surface p-8 text-center">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>

        <div className="flex justify-center mb-6">
          <div className="bg-red-50 p-4 rounded-full">
            <AlertCircle className="w-10 h-10 text-danger" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-text-main mb-2">Authentication Error</h1>
        <p className="text-text-muted mb-6 text-sm">{message}</p>

        {error && (
          <div className="bg-muted rounded-lg p-3 mb-8 text-sm font-mono text-text-muted">
            Error Code: <span className="text-danger">{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <Link href="/login">
            <Button variant="primary" className="w-full">
              Try Signing In Again
            </Button>
          </Link>
          <Link href="/">
            <Button variant="secondary" className="w-full flex items-center justify-center gap-2">
              <ChevronLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>

        <p className="text-xs text-text-muted mt-8 pt-6 border-t border-border">
          If this problem persists, contact the lab administrator.
        </p>
      </div>
    </div>
  );
}

export default function AuthError() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-primary flex items-center justify-center p-4">
          <div className="text-text-muted animate-pulse text-sm">Loading error details...</div>
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}