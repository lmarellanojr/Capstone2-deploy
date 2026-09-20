import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params
  return proxyToApi(req, `/instructor/reviews/${id}`, "GET")
}
