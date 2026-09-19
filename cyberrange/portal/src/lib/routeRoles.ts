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

// AUTH-05 review (Leo, PR #83): requiredRolesForPath returning null means
// "no SPECIFIC role required here", not "any authenticated caller is fine
// regardless of role" -- most matched routes (/dashboard, /scenario/*,
// /lab/*, /progress, /settings, /profile) have no entry above, so an
// authenticated account with none of the three app roles could type one of
// those paths directly and reach the Student portal, bypassing the login
// page's own role-less -> /no-role routing entirely. Used by middleware.ts
// and AuthGate.tsx to redirect that case to /no-role regardless of which
// matched path was requested.
const ALL_APP_ROLES: Role[] = ["student", "instructor", "admin"]

export function hasAnyRecognizedRole(userRoles: string[] | undefined): boolean {
  return hasRequiredRole(userRoles, ALL_APP_ROLES)
}
