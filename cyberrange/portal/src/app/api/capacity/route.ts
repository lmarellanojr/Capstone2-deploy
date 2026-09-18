import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function GET(req: NextRequest) {
  return proxyToApi(req, "/capacity", "GET")
}
