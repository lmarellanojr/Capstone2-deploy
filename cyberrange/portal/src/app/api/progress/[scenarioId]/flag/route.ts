import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function POST(req: NextRequest, { params }: { params: Promise<{ scenarioId: string }> }) {
  const { scenarioId } = await params
  const body = await req.json().catch(() => ({}))
  return proxyToApi(req, `/progress/${scenarioId}/flag`, "POST", body)
}
