import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  return proxyToApi(req, `/instructor/reviews/${id}/resolve`, "POST", body)
}
