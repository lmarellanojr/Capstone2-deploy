import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function POST(req: NextRequest, { params }: { params: Promise<{ scenarioId: string }> }) {
  const { scenarioId } = await params
  return proxyToApi(req, `/progress/${scenarioId}/flag`, "POST")
}
