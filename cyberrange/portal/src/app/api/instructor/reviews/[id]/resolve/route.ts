import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ detail: "Invalid review ID: must be an integer" }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  return proxyToApi(req, `/instructor/reviews/${id}/resolve`, "POST", body)
}
