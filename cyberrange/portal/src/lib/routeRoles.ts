import type { Role } from "next-auth"

// AUTH-04: single source of truth for which role(s) a protected section
// requires, shared by middleware.ts (edge, request-time) and AuthGate.tsx
// (client, render-time) so the two enforcement layers can't drift apart.
// Admin implicitly satisfies /instructor too, matching the backend's
// auth.require_role(["instructor", "admin"]) convention in pods_router.py.
const ROUTE_ROLE_REQUIREMENTS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/instructor", roles: ["instructor", "admin"] },
]

export function requiredRolesForPath(pathname: string): Role[] | null {
  // Segment-aware match, not a bare string prefix: a future route like
  // /instructor-notes must not silently inherit /instructor's requirement.
  const match = ROUTE_ROLE_REQUIREMENTS.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)
  )
  return match ? match.roles : null
}

export function hasRequiredRole(userRoles: string[] | undefined, required: Role[]): boolean {
  if (!userRoles) return false
  return required.some((role) => userRoles.includes(role))
}
