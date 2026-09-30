import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// The SIEM alerts frozen when the student submitted this report.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ detail: "invalid review id" }, { status: 400 })
  return proxyToApi(req, `/instructor/reviews/${id}/alert-snapshot`, "GET")
}
