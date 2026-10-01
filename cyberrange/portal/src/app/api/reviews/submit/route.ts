import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

// Student half of the review workflow: POST /reviews/submit. The backend
// derives the student from the token (never from the body) and refuses
// SCORING_CONFLICT, which only the hybrid scorer may create.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  return proxyToApi(req, "/reviews/submit", "POST", body)
}
