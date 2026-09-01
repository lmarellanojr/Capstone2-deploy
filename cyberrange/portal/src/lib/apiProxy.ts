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

export async function proxyToApi(
  req: NextRequest,
  path: string,
  method: string,
  body?: unknown
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

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    })
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
