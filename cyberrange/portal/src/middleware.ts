import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { requiredRolesForPath, hasRequiredRole, hasAnyRecognizedRole } from "@/lib/routeRoles"

function isUnusableHost(host: string | undefined): boolean {
  if (!host) return true
  const h = host.replace(/^https?:\/\//, "").split("/")[0].split(":")[0]
  return h === "0.0.0.0" || h === ""
}

/** Browser-facing origin. Never 0.0.0.0 (next dev listen address). */
function publicOrigin(req: NextRequest): string {
  const xfHost = req.headers.get("x-forwarded-host") || req.headers.get("host")
  const xfProto = req.headers.get("x-forwarded-proto") || "http"
  if (xfHost && !isUnusableHost(xfHost)) return `${xfProto}://${xfHost}`

  const fromEnv = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  if (fromEnv && !isUnusableHost(fromEnv)) return fromEnv

  return "http://10.115.77.12"
}

export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  })

  if (!token) {
    const origin = publicOrigin(req)
    const login = new URL("/login", origin)
    login.searchParams.set("callbackUrl", `${req.nextUrl.pathname}${req.nextUrl.search}`)
    return NextResponse.redirect(login)
  }

  const roles = token.roles as string[] | undefined

  // AUTH-05 review (Leo, PR #83): most matched paths below (/dashboard,
  // /scenario/*, /lab/*, /progress, /settings, /profile) have no entry in
  // routeRoles.ts -- requiredRolesForPath returns null for them, meaning "no
  // SPECIFIC role required", not "any authenticated caller is fine". An
  // account with none of the three app roles could type one of those paths
  // directly and reach the Student portal, bypassing /login's own
  // role-less -> /no-role routing entirely. /no-role itself is deliberately
  // not in the matcher below, so this can't loop.
  if (!hasAnyRecognizedRole(roles)) {
    return NextResponse.redirect(new URL("/no-role", publicOrigin(req)))
  }

  // AUTH-04: authenticated but wrong role -- e.g. a student typing
  // /instructor or /admin directly into the URL bar. Hiding the nav link is
  // not a security boundary; this check (not client-side UI) is what enforces
  // it. Known limitation: token.roles here is whatever the session cookie
  // already holds -- getToken() only decrypts it, it never re-runs the
  // jwt() callback in lib/auth.ts that re-decodes roles from a fresh Keycloak
  // token. A role revoked in Keycloak mid-session is still honored here until
  // that callback next fires (near access-token expiry, see lib/auth.ts's
  // refreshAccessToken). Not a bypass introduced by this check -- it's the
  // existing JWT-session tradeoff -- but real, so don't assume "enforced here"
  // means "revoked instantly."
  const required = requiredRolesForPath(req.nextUrl.pathname)
  if (required && !hasRequiredRole(roles, required)) {
    return NextResponse.redirect(new URL("/dashboard", publicOrigin(req)))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/scenarios/:path*",
    "/scenario/:path*",
    "/lab/:path*",
    "/progress/:path*",
    "/settings/:path*",
    "/profile/:path*",
    "/instructor/:path*",
    "/admin/:path*",
  ],
}
