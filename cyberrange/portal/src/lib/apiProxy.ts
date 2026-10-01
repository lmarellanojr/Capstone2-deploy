import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"

const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://10.115.77.1:5000"

// Fail loudly at module load if the upstream is not an absolute URL. Server-side
// fetch() of a host-less path (e.g. "/api") throws per-request, which the catch
// below would silently mask as a 503. Surfacing it here makes a misconfigured
// env (e.g. NEXT_PUBLIC_API_URL=/api leaking into the server) fail at boot.
try {
  new URL(API_URL)
} catch {
  throw new Error(
    `apiProxy: API_URL must be an absolute http(s) URL, got "${API_URL}". ` +
      `Set API_INTERNAL_URL (e.g. http://10.115.77.1:5000).`
  )
}

/** Rebuilds a query string from only the named params, so a proxy route never
 *  forwards arbitrary client-chosen parameters upstream. Returns "" or "?…". */
export function forwardQuery(req: NextRequest, allowed: readonly string[]): string {
  const out = new URLSearchParams()
  for (const name of allowed) {
    const value = req.nextUrl.searchParams.get(name)
    if (value !== null && value !== "") out.set(name, value)
  }
  const qs = out.toString()
  return qs ? `?${qs}` : ""
}

interface ProxyOptions {
  /** Pass the upstream body through untouched (e.g. a CSV download) instead
   *  of re-encoding it as JSON. Keeps Content-Type and Content-Disposition. */
  raw?: boolean
  /** Like raw, but as bytes: for images, where res.text() would corrupt the
   *  data. Also keeps the upstream's caching and safety headers. */
  binary?: boolean
  /** Forward the incoming request body as-is with its own Content-Type
   *  (multipart file uploads) instead of JSON-encoding the `body` argument. */
  passBody?: boolean
}

// Headers an image response keeps end to end (the backend sets nosniff and a
// sandbox CSP so a served upload can never run as a page).
const BINARY_PASS_HEADERS = [
  "content-type",
  "content-disposition",
  "cache-control",
  "x-content-type-options",
  "content-security-policy",
]

export async function proxyToApi(
  req: NextRequest,
  path: string,
  method: string,
  body?: unknown,
  options: ProxyOptions = {}
): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (session.accessToken) {
    headers["Authorization"] = `Bearer ${session.accessToken}`
  }

  let fetchBody: BodyInit | undefined = body ? JSON.stringify(body) : undefined
  if (options.passBody) {
    const contentType = req.headers.get("content-type")
    if (contentType) headers["Content-Type"] = contentType
    else delete headers["Content-Type"]
    fetchBody = await req.arrayBuffer()
  }

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: fetchBody,
      cache: "no-store",
    })
    if (options.binary) {
      const passHeaders = new Headers()
      for (const name of BINARY_PASS_HEADERS) {
        const value = res.headers.get(name)
        if (value) passHeaders.set(name, value)
      }
      return new NextResponse(await res.arrayBuffer(), { status: res.status, headers: passHeaders })
    }
    if (options.raw) {
      const passHeaders = new Headers()
      for (const name of ["content-type", "content-disposition"]) {
        const value = res.headers.get(name)
        if (value) passHeaders.set(name, value)
      }
      return new NextResponse(await res.text(), { status: res.status, headers: passHeaders })
    }
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    // Log the real failure (upstream unreachable, DNS, refused, etc.) so a 503
    // is diagnosable instead of silent. The fallbacks below keep the UI degraded
    // rather than crashed.
    console.error(`apiProxy: upstream fetch failed for ${API_URL}${path} (${method}):`, err)
    // Fallback mock data when provisioning API is unavailable
    if (path === "/pods" && method === "GET") {
      return NextResponse.json({ pods: [], count: 0 }, { status: 200 })
    }
    if (path.includes("/pods/provision")) {
      return NextResponse.json({ error: "Provisioning API not available" }, { status: 503 })
    }
    return NextResponse.json({ error: "API unreachable" }, { status: 503 })
  }
}
