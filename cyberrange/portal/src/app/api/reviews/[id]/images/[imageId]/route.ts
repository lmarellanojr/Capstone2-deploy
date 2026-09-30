import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

type Params = { params: Promise<{ id: string; imageId: string }> }

function badIds(id: string, imageId: string) {
  return !/^\d+$/.test(id) || !/^\d+$/.test(imageId)
}

// One screenshot's bytes (passed through as binary with the backend's
// nosniff / sandbox-CSP headers), or delete it (owner only, enforced upstream).
export async function GET(req: NextRequest, { params }: Params) {
  const { id, imageId } = await params
  if (badIds(id, imageId)) return NextResponse.json({ detail: "invalid id" }, { status: 400 })
  return proxyToApi(req, `/reviews/${id}/images/${imageId}`, "GET", undefined, { binary: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, imageId } = await params
  if (badIds(id, imageId)) return NextResponse.json({ detail: "invalid id" }, { status: 400 })
  return proxyToApi(req, `/reviews/${id}/images/${imageId}`, "DELETE")
}
