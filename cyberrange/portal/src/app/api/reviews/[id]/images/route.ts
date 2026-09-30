import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// Evidence screenshots on a review case. The backend enforces owner-or-staff
// access and validates every upload; this route only checks the id shape and
// forwards the multipart body untouched.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ detail: "invalid review id" }, { status: 400 })
  return proxyToApi(req, `/reviews/${id}/images`, "GET")
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ detail: "invalid review id" }, { status: 400 })
  return proxyToApi(req, `/reviews/${id}/images`, "POST", undefined, { passBody: true })
}
