import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// GAP-02: GET /instructor/pods — every live student pod with its milestone
// history (instructor/admin only, enforced by the backend).
export async function GET(req: NextRequest) {
  return proxyToApi(req, "/instructor/pods", "GET")
}
