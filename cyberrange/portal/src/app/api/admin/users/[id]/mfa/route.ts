import { NextRequest, NextResponse } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// Keycloak user ids are UUIDs (users_router.USER_ID_PATTERN); reject anything
// else here so it never reaches an upstream URL path.
const USER_ID = /^[0-9a-fA-F-]{36}$/

// SEC-03: Admin resets another user's authenticator (lost phone). The user
// enrols a new one at their next sign-in.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params
  if (!USER_ID.test(id)) {
    return NextResponse.json({ detail: "Invalid user ID" }, { status: 400 })
  }
  return proxyToApi(req, `/admin/users/${id}/mfa`, "DELETE")
}
