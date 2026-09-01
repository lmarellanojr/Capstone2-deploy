import { NextResponse } from 'next/server'
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

// Use the internal URL for server-side fetch — NEXT_PUBLIC_API_URL is a relative path for browsers
const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://10.115.77.1:5000"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ podId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { podId } = await params

  let token: string
  let connectionId: number

  try {
    const headers: Record<string, string> = {}
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`
    }

    const res = await fetch(`${API_URL}/pods/${podId}/guac-token`, {
      headers,
      cache: 'no-store',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: body.detail || 'Failed to get Guacamole token' },
        { status: res.status }
      )
    }
    const data = await res.json()
    token = data.token
    connectionId = data.connection_id
  } catch {
    return NextResponse.json({ error: 'Provisioning API unreachable' }, { status: 503 })
  }

  // Guacamole requires identifiers in the format: <id>\0<type>\0<dataSource>
  // 'c' indicates a connection (as opposed to 'g' for connection group)
  const rawId = `${connectionId}\0c\0mysql`
  const b64Id = Buffer.from(rawId).toString('base64')

  // Bootstrap page: sets Guacamole localStorage auth then redirects.
  // Same-origin means localStorage set here is visible to the Guacamole JS app.
  const html = `<!DOCTYPE html>
<html>
<head>
<script>
try {
  localStorage.setItem('GUAC_AUTH', JSON.stringify({
    authToken: ${JSON.stringify(token)},
    dataSource: 'mysql'
  }));
} catch (e) {}
window.location.replace('/guacamole/#/client/${b64Id}');
</script>
</head>
<body></body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
