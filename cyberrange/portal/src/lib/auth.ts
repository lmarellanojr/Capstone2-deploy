import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { decodeJwt } from "jose";
// Session import merged into line 1

// Split-brain Keycloak: internal URL for server-side token exchange,
// public URL for browser-facing OAuth redirect.
//
// KEYCLOAK_ISSUER        = http://10.0.10.12:8083/realms/cyber-range
//                          (Docker container → Keycloak, server-side only)
// KEYCLOAK_PUBLIC_ISSUER = https://<tunnel>/realms/cyber-range
//                          (browser → Keycloak through nginx proxy → Cloudflare tunnel)
const issuerInternal = process.env.KEYCLOAK_ISSUER || ""
const issuerPublic = process.env.KEYCLOAK_PUBLIC_ISSUER || issuerInternal

// Server-side (token/userinfo/jwks/refresh) target. Defaults to the internal
// issuer -- safe when Keycloak's own hostname/frontendUrl config makes `iss`
// consistent regardless of request path (confirmed true on .110, 2026-08-08),
// and required when the portal's server-side process has no public internet
// egress (also true on .110's container -- there is no route to the public
// issuer at all from there). Some Keycloak deployments instead derive `iss`
// from the request path rather than a fixed frontendUrl (confirmed true on
// .111, 2026-08-08, via a direct password-grant token comparison) -- those
// hosts MUST override this to match KEYCLOAK_PUBLIC_ISSUER via
// KEYCLOAK_SERVER_SIDE_ISSUER in .env.production, or token exchange will
// mint a token whose `iss` claim does not match the `issuer` validated
// below, and login will fail. See Docs/2026-08-08_AUTH_110_HOTFIX-TRB.md.
const issuerServerSide = process.env.KEYCLOAK_SERVER_SIDE_ISSUER || issuerInternal

// AUTH-01: realm roles live in the Keycloak access token's own JWT payload
// (realm_access.roles) -- Keycloak's token-introspection response (used
// server-side by the FastAPI backend, see provisioning/auth.py) does not
// reliably echo that claim, but the signed JWT itself always carries
// whatever the realm mapped onto it. This is an unsigned payload decode, not
// a second signature verification: NextAuth's own OAuth client already
// validated this token during the authorization-code exchange, so we are
// reading claims, not re-authenticating.
function decodeRoles(accessToken?: string): string[] {
  if (!accessToken) return []
  try {
    const claims = decodeJwt(accessToken) as { realm_access?: { roles?: string[] } }
    return claims.realm_access?.roles ?? []
  } catch {
    return []
  }
}

// Single-flight: many concurrent `useSession` reads can enter the near-expiry
// window at once. Keyed by the current refresh token, they share ONE Keycloak
// call instead of stampeding it.
const inflightRefresh = new Map<string, Promise<JWT>>()

function refreshAccessToken(token: JWT): Promise<JWT> {
  const key = token.refreshToken
  if (!key) return doRefresh(token)
  const existing = inflightRefresh.get(key)
  if (existing) return existing
  const p = doRefresh(token).finally(() => inflightRefresh.delete(key))
  inflightRefresh.set(key, p)
  return p
}

/**
 * Exchange the Keycloak refresh token for a new access token at the INTERNAL
 * token endpoint (confidential client). Keycloak rotates the refresh token by
 * default, so we persist the returned one. On any failure we mark the JWT with
 * `error` so the client can force a real re-login (handled in api.ts).
 */
async function doRefresh(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) throw new Error("missing refresh_token at refresh time")
    // Use public issuer token endpoint so refreshed tokens keep public `iss`
    // (same base as authorization). Internal :8083 discovery without
    // X-Forwarded-* would mint loopback iss and break validation on staging.
    const resp = await fetch(`${issuerServerSide}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.KEYCLOAK_CLIENT_ID || "",
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET || "",
        refresh_token: token.refreshToken,
      }),
    })
    const refreshed = await resp.json()
    if (!resp.ok) {
      // KC error body carries error/error_description but NEVER a token — safe to log
      throw new Error(`kc ${resp.status} ${refreshed.error || ""} ${refreshed.error_description || ""}`)
    }
    return {
      ...token,
      accessToken: refreshed.access_token,
      // Re-decode roles from the freshly-issued token, not carried over from
      // initial sign-in: Keycloak evaluates role mappings at issuance time,
      // so a role change made mid-session (e.g. an admin promoting/demoting
      // a user) must show up on the next refresh, not only after the user's
      // NextAuth session cookie expires and they fully re-authenticate.
      roles: decodeRoles(refreshed.access_token),
      accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    }
  } catch (e) {
    console.error("RefreshAccessTokenError:", e instanceof Error ? e.message : "refresh failed")
    return { ...token, error: "RefreshAccessTokenError" }
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "keycloak",
      name: "Sign in with Keycloak",
      type: "oauth",
      // Do NOT use wellKnown against KEYCLOAK_ISSUER (loopback :8083). Discovery
      // without X-Forwarded-* returns authorization_endpoint on 127.0.0.1, and
      // next-auth overwrites any explicit authorization.url — browsers then open
      // http://127.0.0.1:8083/... (connection refused on the user's PC).
      // Endpoints are explicit: browser auth via public issuer (LAN/tunnel);
      // token/userinfo/jwks via the same public base so `iss` stays consistent
      // with KEYCLOAK_PUBLIC_ISSUER (reachable from guac via host:8080 hairpin).
      authorization: {
        url: `${issuerPublic}/protocol/openid-connect/auth`,
        params: { scope: "openid email profile", response_type: "code" },
      },
      token: `${issuerServerSide}/protocol/openid-connect/token`,
      userinfo: `${issuerServerSide}/protocol/openid-connect/userinfo`,
      jwks_endpoint: `${issuerServerSide}/protocol/openid-connect/certs`,
      clientId: process.env.KEYCLOAK_CLIENT_ID || "",
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || "",
      // issuer must match the `iss` claim in Keycloak's JWT (public frontend URL).
      issuer: issuerPublic,
      idToken: true,
      checks: ["pkce", "state"],
      profile(profile: Record<string, unknown>) {
        return {
          id: String(profile.sub ?? ""),
          // BUG-013 Fix: Use preferred_username as the display name and student_id key.
          // This ensures consistency with the provisioning backend and database.
          name: String(profile.preferred_username ?? profile.name ?? "User"),
          email: String(profile.email ?? ""),
          image: String(profile.picture ?? ""),
        }
      },
    },
  ],
  // Cookie handling is intentionally left at next-auth's defaults.
  //
  // Do not re-add a cookies:{} override with sameSite:"none" here. Keycloak is
  // served at /auth/ on the same origin as this portal, so the OAuth callback is
  // a same-site top-level GET navigation and the default sameSite:"lax" cookies
  // are sent normally. SameSite=None would only weaken CSRF protection on the
  // session and on the __Host- prefixed CSRF token, and fixes nothing.
  //
  // useSecureCookies is likewise omitted: next-auth already enables secure
  // cookies when NEXTAUTH_URL is https://, which it is.
  //
  // "State cookie was missing" on 2026-08-05 was caused by signIn(redirect:false)
  // never navigating the browser, not by cookie attributes. See
  // Docs/superpowers/plans/2026-08-05-portal-oauth-callback-failure-TRB.md (Q2).
  session: {
    strategy: "jwt",
    maxAge: 12 * 60 * 60, // 12 hours (matches Keycloak access token lifespan)
  },
  pages: {
    signIn: "/login",
    error: "/auth-error",
  },
  callbacks: {
    async jwt({ token, account }: { token: any; account?: any }) {
      // Initial sign-in: capture access + refresh + absolute expiry (epoch ms).
      // [TRB C5] Harden expiry capture: prefer Keycloak's absolute expires_at,
      // fall back to expires_in, then to a 300s default — never 0 (which would
      // force a refresh on every request).
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.roles = decodeRoles(account.access_token)
        const expiresInSec =
          (account.expires_at as number | undefined) ??
          (account.expires_in ? Math.floor(Date.now() / 1000) + (account.expires_in as number) : undefined) ??
          (Math.floor(Date.now() / 1000) + 300)
        token.accessTokenExpires = expiresInSec * 1000
        return token
      }
      // Still valid (60s safety buffer before real expiry) → reuse.
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - 60_000) {
        return token
      }
      // Expired/near-expiry → refresh (single-flight collapses concurrent reads).
      return refreshAccessToken(token)
    },
    async session({ session, token }: { session: any; token: any }) {
      session.accessToken = token.accessToken as string | undefined
      session.error = token.error as string | undefined
      // AUTH-01: session.user is already populated by next-auth's default
      // profile() merge (name/email/image) before this callback runs -- we
      // only add roles onto it, we don't reconstruct it.
      if (session.user) {
        session.user.roles = (token.roles as string[] | undefined) ?? []
      }
      return session
    },
  },
}
