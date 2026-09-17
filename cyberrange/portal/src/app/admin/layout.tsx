import { AuthGate } from "@/components/auth/AuthGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate requiredRoles={["admin"]}>{children}</AuthGate>;
}
