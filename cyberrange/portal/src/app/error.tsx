"use client";

import Link from "next/link";
import { Button } from "@/components/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-primary p-4">
      <div className="card-surface p-8 text-center max-w-md w-full">
        <h1 className="text-3xl font-bold mb-4 text-danger">Error</h1>
        <p className="text-text-muted mb-6">{error.message || "An unexpected error occurred"}</p>
        <div className="flex gap-4">
          <Button variant="primary" onClick={() => reset()} className="flex-1">
            Try Again
          </Button>
          <Link href="/login" className="flex-1">
            <Button variant="secondary" className="w-full">
              Back to Login
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}