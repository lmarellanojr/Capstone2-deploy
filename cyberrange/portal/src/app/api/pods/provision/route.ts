import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  return proxyToApi(req, "/pods/provision", "POST", body)
}
