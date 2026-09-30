import { NextRequest } from "next/server"
import { forwardQuery, proxyToApi } from "@/lib/apiProxy"

// Read-only audit trail (audit_router.py). Admin-only is enforced by the backend.
export async function GET(req: NextRequest) {
  const qs = forwardQuery(req, ["event_type", "student_id", "result", "before_id", "limit"])
  return proxyToApi(req, `/admin/audit-log${qs}`, "GET")
}
