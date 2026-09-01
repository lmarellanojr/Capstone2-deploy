import { NextRequest } from "next/server"
import { proxyToApi } from "@/lib/apiProxy"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; scenario: string; milestone: string }> }) {
  const { id, scenario, milestone } = await params
  return proxyToApi(req, `/pods/${id}/verify/${scenario}/${milestone}`, "POST")
}
