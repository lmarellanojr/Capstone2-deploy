import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

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
