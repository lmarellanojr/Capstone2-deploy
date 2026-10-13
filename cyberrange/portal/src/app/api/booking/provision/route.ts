import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"

const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://10.115.77.1:5000"

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(req: NextRequest) {
  const expected = process.env.BOOKING_PROVISION_SECRET
  if (!expected) return NextResponse.json({ error: "Booking provisioning is not configured" }, { status: 503 })
  if (!secretMatches(req.headers.get("x-booking-provision-secret"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > 2048) return NextResponse.json({ error: "Invalid request" }, { status: 413 })
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (!body || typeof body !== "object" || typeof (body as { email?: unknown }).email !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  try {
    const upstream = await fetch(`${API_URL.replace(/\/$/, "")}/internal/booking/user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Booking-Provision-Secret": expected,
      },
      body: JSON.stringify({ email: (body as { email: string }).email }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    })
    const result = await upstream.json().catch(() => ({}))
    const status = typeof result.status === "string" ? result.status : "failed"
    const allowed = ["created", "existing", "pending", "email_failed", "needs_review", "failed"]
    const delivery = ["sent", "skipped", "failed"].includes(result.credential_email_status)
      ? result.credential_email_status
      : "skipped"
    if (!upstream.ok) return NextResponse.json({ status: "failed", credential_email_status: "skipped" }, { status: upstream.status })
    return NextResponse.json({
      status: allowed.includes(status) ? status : "failed",
      credential_email_status: delivery,
    }, { status: 200, headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ status: "unknown", credential_email_status: "skipped" }, { status: 504 })
  }
}
