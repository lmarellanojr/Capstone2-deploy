import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// Read-only SIEM alerts for any student's pod (instructor/admin only,
// enforced by the backend). Mirrors /api/pods/[id]/alerts, plus a numeric
// id check so an encoded "/" can't steer the proxied path elsewhere.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ detail: "invalid pod id" }, { status: 400 })
  return proxyToApi(req, `/instructor/pods/${id}/alerts${req.nextUrl.search}`, "GET")
}
