import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/pods/${id}/alerts${req.nextUrl.search}`, "GET")
}
