import { NextRequest } from "next/server"
import { forwardQuery, proxyToApi } from "@/lib/apiProxy"

// ADM-USER (users_router.py): list + create. Admin-only is enforced by the
// backend (_require_admin + a fresh Keycloak re-check on every write).
export async function GET(req: NextRequest) {
  return proxyToApi(req, `/admin/users${forwardQuery(req, ["search", "first", "max"])}`, "GET")
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  return proxyToApi(req, "/admin/users", "POST", body)
}
