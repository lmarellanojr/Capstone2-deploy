import { AuthGate } from "@/components/auth/AuthGate";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
