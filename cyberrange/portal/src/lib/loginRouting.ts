import { requiredRolesForPath, hasRequiredRole } from "@/lib/routeRoles"

// Review finding (Leo, PR #83): a raw callbackUrl string (e.g.
// "https://evil.example", "//evil.example", "/\evil.example" -- the last two
// are protocol-relative once the WHATWG URL parser normalizes backslashes to
// slashes for http(s)) reaching router.push unvalidated is an open redirect:
// Next 14's router.push does a full cross-origin navigation for an external
// URL. NextAuth's own redirect validation only covers the signIn() call, not
// a push made after landing back on this page. Resolving against `origin`
// and comparing .origin catches all three forms; returns only the
// path+search+hash, never the caller's raw string, so nothing external can
// ever reach router.push even if a caller forgets to check the return value.
export function resolveSameOriginPath(value: string | null, origin: string): string | null {
  if (!value) return null
  try {
    const resolved = new URL(value, origin)
    if (resolved.origin !== origin) return null
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return null
  }
}

// AUTH-05: one role per account (confirmed by Lenie + Leonardo — no multi-role,
// no self-signup), so this is a plain lookup, not a priority order. Returns
// null when the account has none of the three app roles, which routes to
// /no-role instead of any portal.
export function landingPathForRole(roles: string[] | undefined): string | null {
  if (roles?.includes("admin")) return "/admin"
  if (roles?.includes("instructor")) return "/instructor"
  if (roles?.includes("student")) return "/dashboard"
  return null
}

// Review finding (Leo, PR #83): "/" and "/dashboard" are the generic default
// the sign-out flow always injects here -- federated-logout's
// post_logout_redirect_uri is the portal root, "/" redirects to "/dashboard",
// and middleware (no token) sends that to /login?callbackUrl=/dashboard. That
// is not a real deep-link the user was trying to reach, so it must never
// override a role-specific landing path (it would send instructor_demo/
// admin_demo straight to the Student portal on the sign-out -> sign-in-again
// flow). Any OTHER explicit target is honored only if the account's role
// actually satisfies it there -- the same check middleware.ts uses, imported
// from routeRoles.ts rather than re-implemented, so this can't send someone
// to a page their role wouldn't be allowed to load anyway.
export function shouldHonorCallbackUrl(path: string, roles: string[] | undefined): boolean {
  if (path === "/" || path === "/dashboard") return false
  const required = requiredRolesForPath(path)
  return !required || hasRequiredRole(roles, required)
}
