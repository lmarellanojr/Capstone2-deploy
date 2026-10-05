import { getToken } from "next-auth/jwt"
import { NextRequest, NextResponse } from "next/server"
import { publicOrigin } from "@/lib/publicOrigin"

function trimSlash(v: string | undefined): string {
  return (v || "").replace(/\/$/, "")
}

// NextAuth's JWT session cookie, plus the numbered chunks it splits a large
// cookie into (.0, .1, ...); the __Secure- prefix is used over https.
const SESSION_COOKIE = /^(__Secure-)?next-auth\.session-token(\.\d+)?$/

/**
 * Redirect to Keycloak's logout and end the portal session in the same
 * response. Logout buttons navigate here directly (not via next-auth's
 * signOut()), so the session cookie still holds the id_token when this runs.
 */
function logoutRedirect(req: NextRequest, target: string): NextResponse {
  const res = NextResponse.redirect(target)
  for (const { name } of req.cookies.getAll()) {
    if (SESSION_COOKIE.test(name)) {
      res.cookies.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: name.startsWith("__Secure-"),
      })
    }
  }
  return res
}

export async function GET(req: NextRequest) {
  const portal = trimSlash(process.env.NEXTAUTH_URL)
  const issuerPublic = trimSlash(
    process.env.KEYCLOAK_PUBLIC_ISSUER || process.env.KEYCLOAK_ISSUER
  )
  // GAP-11: with NEXTAUTH_URL unset, go back to the host the browser used
  // instead of a hardcoded lab IP (10.115.77.12).
  const home = portal || publicOrigin(req)

  try {
    if (!issuerPublic) {
      console.error("federated-logout: set KEYCLOAK_PUBLIC_ISSUER or KEYCLOAK_ISSUER")
      return logoutRedirect(req, `${home}/login?error=LogoutConfig`)
    }
    if (!portal) {
      console.error("federated-logout: set NEXTAUTH_URL")
      return logoutRedirect(req, `${home}/login?error=LogoutConfig`)
    }

    const clientId = process.env.KEYCLOAK_CLIENT_ID || "portal"
    const url = new URL(`${issuerPublic}/protocol/openid-connect/logout`)
    url.searchParams.append("client_id", clientId)
    url.searchParams.append("post_logout_redirect_uri", portal)

    // id_token_hint tells Keycloak exactly which session to end, so it logs
    // out at once and returns to the portal (/ -> "Enter Cyber Range") instead
    // of showing its "Do you want to log out?" confirmation. Read from the
    // encrypted NextAuth JWT on the server; it is never exposed to the browser.
    const jwt = await getToken({ req })
    const idToken = typeof jwt?.idToken === "string" ? jwt.idToken : undefined
    if (idToken) {
      url.searchParams.append("id_token_hint", idToken)
    }

    return logoutRedirect(req, url.toString())
  } catch (error) {
    console.error("Federated logout error:", error)
    return logoutRedirect(req, `${home}/login`)
  }
}
