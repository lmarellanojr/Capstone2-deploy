import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ detail: "Invalid review ID: must be an integer" }, { status: 400 })
  }
  return proxyToApi(req, `/instructor/reviews/${id}`, "GET")
}
