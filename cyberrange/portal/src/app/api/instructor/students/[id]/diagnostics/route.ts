import { NextRequest } from "next/server"
import { forwardQuery, proxyToApi } from "@/lib/apiProxy"

// Scenario 3 check failure reasons for one student (instructor/admin only,
// enforced by the backend). Only the one-lab filters are forwarded.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const qs = forwardQuery(req, ["pod_id", "pod_created_at"])
  return proxyToApi(req, `/instructor/students/${encodeURIComponent(id)}/diagnostics${qs}`, "GET")
}
