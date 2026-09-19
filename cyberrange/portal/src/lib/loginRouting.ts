import { requiredRolesForPath, hasRequiredRole } from "@/lib/routeRoles"

export { landingPathForRole } from "@/lib/routeRoles"

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
//
// Follow-up finding (Leo, PR #83): the FIRST resolve alone isn't enough.
// Dot-segment normalization inside new URL() can itself produce a pathname
// that starts with "//" even though the resolve was genuinely same-origin --
// e.g. "/.//evil.example", "/x/..//evil.example", "/%2e//evil.example", and
// a backslash-as-separator variant all normalize to pathname "//evil.example"
// here. That string is safe as *part of* the already-parsed URL object, but
// once handed to router.push (or re-embedded in the signIn callbackUrl) it
// gets re-parsed on its own, and a bare "//host" is a protocol-relative
// reference -- an origin bypass, verified against a real login page: an
// authenticated instructor at /login?callbackUrl=/.//evil.example got
// router.push("//evil.example") and left the site. Re-resolving the
// candidate output against `origin` a second time and checking .origin
// again catches this: a genuinely safe path resolves to the same origin
// every time, but a string that's only safe as a sub-part of a larger URL
// reveals its true (different) origin once parsed standalone.
export function resolveSameOriginPath(value: string | null, origin: string): string | null {
  if (!value) return null
  try {
    const resolved = new URL(value, origin)
    if (resolved.origin !== origin) return null
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`
    const reResolved = new URL(path, origin)
    if (reResolved.origin !== origin) return null
    return path
  } catch {
    return null
  }
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
//
// Follow-up finding (Leo, PR #83): `path` here is path+search+hash from
// resolveSameOriginPath, but the generic-default check and
// requiredRolesForPath both need the bare pathname -- exact-matching the
// full string let "/dashboard?x=1" and "/dashboard/" slip past the default
// check (reproducing the original sign-out bug via a different string) and
// let "/admin?x=1" read as "unrestricted" for an instructor (middleware
// happens to catch that one independently on the real request, but the
// reasoning here was still wrong). Reproduced live on 52ef847. Parsing out
// just the pathname, with any trailing slash stripped, before either check
// fixes both.
export function shouldHonorCallbackUrl(path: string, roles: string[] | undefined): boolean {
  let pathname: string
  try {
    pathname = new URL(path, "http://placeholder.invalid").pathname.replace(/\/+$/, "") || "/"
  } catch {
    return false
  }
  if (pathname === "/" || pathname === "/dashboard") return false
  const required = requiredRolesForPath(pathname)
  return !required || hasRequiredRole(roles, required)
}
