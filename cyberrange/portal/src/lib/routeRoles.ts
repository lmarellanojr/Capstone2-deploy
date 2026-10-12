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

// Standalone recognized-role predicate. Middleware and AuthGate use
// redirectPathForRole below, whose landing-path check enforces the no-role gate.
const ALL_APP_ROLES: Role[] = ["student", "instructor", "admin"]
const ONBOARDING_ALLOWLIST = new Set(["/orientation", "/login", "/no-role", "/auth-error"])

export function hasAnyRecognizedRole(userRoles: string[] | undefined): boolean {
  return hasRequiredRole(userRoles, ALL_APP_ROLES)
}

// AUTH-05: the login page's post-auth landing path. Moved here next to
// ROUTE_ROLE_REQUIREMENTS (review finding, Leo PR #83) so the role -> path
// mapping has one home instead of being split between this file and
// lib/loginRouting.ts.
//
// AUTH-04 intentionally prioritizes admin, then instructor, then student.
// For multi-role accounts this determines both the login destination and
// dashboard entry: redirectPathForRole sends a student+instructor account
// away from /dashboard to /instructor; any admin role takes priority.
// The demo accounts have one role each, but this policy also applies when
// role assignment (ADM-USER-04) allows multiple roles on an account.
export function landingPathForRole(roles: string[] | undefined): string | null {
  if (roles?.includes("admin")) return "/admin"
  if (roles?.includes("instructor")) return "/instructor"
  if (roles?.includes("student")) return "/dashboard"
  return null
}

// Keep request-time middleware and the client gate aligned. Only dashboard
// entry changes by role; permitted deep links and shared lab pages stay put.
// requiredRolesForPath returning null means no specific role is required,
// not that an account without an application role may enter. The landing
// check sends those accounts to /no-role even on shared routes.
export function redirectPathForRole(pathname: string, roles: string[] | undefined): string | null {
  const landing = landingPathForRole(roles)
  if (!landing) return "/no-role"
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path === "/dashboard" && landing !== "/dashboard") return landing
  const required = requiredRolesForPath(path)
  if (required && !hasRequiredRole(roles, required)) return landing
  return null
}

export function onboardingRedirectPath(
  pathname: string,
  search: string,
  roles: string[] | undefined,
  completed: boolean,
): string | null {
  if (ONBOARDING_ALLOWLIST.has(pathname) || completed || !landingPathForRole(roles)) return null
  return `/orientation?returnTo=${encodeURIComponent(`${pathname}${search}`)}`
}
