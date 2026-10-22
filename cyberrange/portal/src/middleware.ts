import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { redirectPathForRole } from "@/lib/routeRoles"
// Browser-facing origin, never 0.0.0.0 and never a hardcoded host (GAP-11).
import { publicOrigin } from "@/lib/publicOrigin"
import {
  isDvwaRequest,
  secureDefaultResponse,
  secureDvwaResponse,
} from "@/lib/dvwaSecurityPolicy"

function finalizeMiddlewareResponse(pathname: string, response: NextResponse): NextResponse {
  // Middleware redirects do not reliably inherit next.config headers() on Next 15.5.28.
  return isDvwaRequest(pathname)
    ? secureDvwaResponse(response)
    : secureDefaultResponse(response)
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
    return finalizeMiddlewareResponse(req.nextUrl.pathname, NextResponse.redirect(login))
  }

  const roles = token.roles as string[] | undefined

  // AUTH-05: no-role → /no-role; staff on /dashboard → role landing; wrong-role
  // for /admin|/instructor → landing. Decisions live in redirectPathForRole so
  // middleware and AuthGate stay aligned. /no-role is outside this matcher.
  //
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
  const redirectPath = redirectPathForRole(req.nextUrl.pathname, roles)
  if (redirectPath) {
    const response = NextResponse.redirect(new URL(redirectPath, publicOrigin(req)))
    return finalizeMiddlewareResponse(req.nextUrl.pathname, response)
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
