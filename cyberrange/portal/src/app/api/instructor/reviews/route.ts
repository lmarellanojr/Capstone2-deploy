import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function GET(req: NextRequest) {
  const search = req.nextUrl.search
  return proxyToApi(req, `/instructor/reviews${search}`, "GET")
}
