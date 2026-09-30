import {
  Activity,
  ClipboardCheck,
  FlaskConical,
  GraduationCap,
  LayoutDashboard,
  ScrollText,
  Server,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

// Shared nav item shape for the Student/Instructor/Admin sidebars (see Sidebar.tsx).
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  disabled?: boolean;
}

export const studentNavItems = (labCount: number): NavItem[] => [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/scenarios", label: "My Labs", icon: FlaskConical, badge: String(labCount) },
];

export const instructorNavItems: NavItem[] = [
  { href: "/instructor", label: "Dashboard", icon: LayoutDashboard },
  { href: "/instructor/pods", label: "Live labs", icon: Activity },
  { href: "/instructor/students", label: "Students", icon: Users },
  { href: "/instructor/reviews", label: "Reviews", icon: ClipboardCheck },
];

// Admins may use every /instructor/* page (routeRoles.ts + the backend's
// require_role(["instructor","admin"])), so the Admin sidebar links there
// instead of making them type the URL.
export const adminNavItems: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/pods", label: "Pods", icon: Server },
  { href: "/admin/system", label: "System", icon: Settings },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/instructor", label: "Instructor view", icon: GraduationCap },
];
