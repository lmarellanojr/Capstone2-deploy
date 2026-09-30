import { NextRequest } from "next/server"
import { forwardQuery, proxyToApi } from "@/lib/apiProxy"

// SCORE-02 (#101) / PAPER-16: knowledge-gain export. `raw` because format=csv
// returns a text/csv attachment that must reach the browser byte-for-byte.
export async function GET(req: NextRequest) {
  const qs = forwardQuery(req, ["format", "scenario_id", "status_filter", "anonymize"])
  return proxyToApi(req, `/instructor/export/knowledge-gain${qs}`, "GET", undefined, { raw: true })
}
