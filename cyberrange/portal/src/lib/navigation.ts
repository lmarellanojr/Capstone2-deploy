export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: string;
  disabled?: boolean;
}

export const instructorNavItems: NavItem[] = [
  { href: "/instructor", label: "Dashboard", icon: "▦" },
  { href: "/instructor/students", label: "Students", icon: "◎" },
  { href: "/instructor/reviews", label: "Reviews", icon: "☑" },
];

export const adminNavItems: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "▦" },
  { href: "/admin/users", label: "Users", icon: "◎" },
  { href: "/admin/pods", label: "Pods", icon: "▣" },
  { href: "/admin/system", label: "System", icon: "⚙" },
];
