// Browser-facing origin of this portal, for absolute redirects (middleware,
// federated logout). Pure and edge-safe: middleware.ts imports it.
//
// Order: the proxy/Host headers the browser actually used, then NEXTAUTH_URL,
// then the request's own origin. There is deliberately no hardcoded host
// (GAP-11): the old last resort was the lab's 10.115.77.12, which silently
// sent users to the wrong machine on any other deployment.

interface RequestLike {
  headers: { get(name: string): string | null }
  nextUrl: { origin: string }
}

/** True for a host a browser can't use: missing, empty, or 0.0.0.0 (the
 *  address `next dev` listens on). */
export function isUnusableHost(host: string | null | undefined): boolean {
  if (!host) return true
  const h = host.replace(/^https?:\/\//, "").split("/")[0].split(":")[0]
  return h === "0.0.0.0" || h === ""
}

export function publicOrigin(req: RequestLike, nextAuthUrl: string | undefined = process.env.NEXTAUTH_URL): string {
  const xfHost = req.headers.get("x-forwarded-host") || req.headers.get("host")
  const xfProto = req.headers.get("x-forwarded-proto") || "http"
  if (xfHost && !isUnusableHost(xfHost)) return `${xfProto}://${xfHost}`

  const fromEnv = nextAuthUrl?.replace(/\/$/, "")
  if (fromEnv && !isUnusableHost(fromEnv)) return fromEnv

  // Same server that received the request; only 0.0.0.0 is rewritten, since
  // a browser can't open it but localhost reaches the same dev server.
  return req.nextUrl.origin.replace("://0.0.0.0", "://localhost")
}
