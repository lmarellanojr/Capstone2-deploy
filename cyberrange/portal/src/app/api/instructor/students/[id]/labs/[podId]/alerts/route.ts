import { NextRequest, NextResponse } from "next/server"
import { forwardQuery, proxyToApi } from "@/lib/apiProxy"

// Archived SIEM alerts for one of the student's labs. Only started_at/limit are
// forwarded; the backend derives the time window itself from (pod, start).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; podId: string }> }
) {
  const { id, podId } = await params
  if (!/^\d+$/.test(podId)) return NextResponse.json({ detail: "invalid pod id" }, { status: 400 })
  const qs = forwardQuery(req, ["started_at", "limit"])
  return proxyToApi(req, `/instructor/students/${encodeURIComponent(id)}/labs/${podId}/alerts${qs}`, "GET")
}
