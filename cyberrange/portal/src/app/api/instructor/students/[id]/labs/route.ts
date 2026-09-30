import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// Every lab this student has run, for the instructor SIEM history
// (instructor/admin only, enforced by the backend).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/instructor/students/${encodeURIComponent(id)}/labs`, "GET")
}
