import Link from "next/link";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-primary p-4">
      <div className="card-surface p-8 text-center max-w-md w-full">
        <h1 className="text-4xl font-bold mb-2 text-brand">404</h1>
        <h2 className="text-2xl font-semibold mb-4 text-text-main">Page Not Found</h2>
        <p className="text-text-muted mb-8">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/">
          <Button variant="primary" size="lg" className="w-full">
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}