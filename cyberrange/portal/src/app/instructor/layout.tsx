import { AuthGate } from "@/components/auth/AuthGate";

export default function InstructorLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate requiredRoles={["instructor", "admin"]}>{children}</AuthGate>;
}
