import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function GET(req: NextRequest) {
  return proxyToApi(req, "/users/me/orientation", "GET")
}

export async function POST(req: NextRequest) {
  return proxyToApi(req, "/users/me/orientation", "POST")
}
