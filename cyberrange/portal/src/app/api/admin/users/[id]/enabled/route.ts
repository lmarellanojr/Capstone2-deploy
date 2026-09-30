import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// Keycloak user ids are UUIDs (users_router.USER_ID_PATTERN); reject anything
// else here so it never reaches an upstream URL path.
const USER_ID = /^[0-9a-fA-F-]{36}$/

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params
  if (!USER_ID.test(id)) {
    return NextResponse.json({ detail: "Invalid user ID" }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  return proxyToApi(req, `/admin/users/${id}/enabled`, "PATCH", body)
}
