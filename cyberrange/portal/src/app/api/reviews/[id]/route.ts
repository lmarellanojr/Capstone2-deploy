import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// GET /reviews/{id}: owner (or staff) only; the backend answers 404 for
// someone else's case and for any SCORING_CONFLICT case seen by a student.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ detail: "Invalid review ID: must be an integer" }, { status: 400 })
  }
  return proxyToApi(req, `/reviews/${id}`, "GET")
}
