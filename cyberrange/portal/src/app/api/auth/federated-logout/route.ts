import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { NextResponse } from "next/server"

function trimSlash(v: string | undefined): string {
  return (v || "").replace(/\/$/, "")
}

export async function GET() {
  const portal = trimSlash(process.env.NEXTAUTH_URL)
  const issuerPublic = trimSlash(
    process.env.KEYCLOAK_PUBLIC_ISSUER || process.env.KEYCLOAK_ISSUER
  )
  const home = portal || "http://10.115.77.12"

  try {
    const session = await getServerSession(authOptions)
    if (!issuerPublic) {
      console.error("federated-logout: set KEYCLOAK_PUBLIC_ISSUER or KEYCLOAK_ISSUER")
      return NextResponse.redirect(`${home}/login?error=LogoutConfig`)
    }
    if (!portal) {
      console.error("federated-logout: set NEXTAUTH_URL")
      return NextResponse.redirect(`${home}/login?error=LogoutConfig`)
    }

    const clientId = process.env.KEYCLOAK_CLIENT_ID || "portal"
    const url = new URL(`${issuerPublic}/protocol/openid-connect/logout`)
    url.searchParams.append("client_id", clientId)
    url.searchParams.append("post_logout_redirect_uri", portal)

    if (session && (session as { idToken?: string }).idToken) {
      url.searchParams.append("id_token_hint", (session as { idToken: string }).idToken)
    }

    return NextResponse.redirect(url.toString())
  } catch (error) {
    console.error("Federated logout error:", error)
    return NextResponse.redirect(`${home}/login`)
  }
}
