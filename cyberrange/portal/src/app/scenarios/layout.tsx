import { AuthGate } from "@/components/auth/AuthGate";

export default function ScenariosLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
