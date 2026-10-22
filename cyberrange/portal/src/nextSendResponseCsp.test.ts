// CR-11: the route owns DVWA CSP; Next must deliver it without a config collision.
import http from "http"
import type { AddressInfo } from "net"
import { sendResponse } from "next/dist/server/send-response"
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node"
import { dvwaContentSecurityPolicy } from "./lib/dvwaProxy"

async function sentCspHeaders(dvwaPath: string): Promise<string[]> {
  const csp = dvwaContentSecurityPolicy(dvwaPath)
  if (!csp) throw new Error(`no sandbox CSP for ${dvwaPath}`)
  const server = http.createServer(async (req, res) => {
    // Config deliberately sets no CSP on DVWA. The route owns the full policy.
    const response = new Response("ok", {
      headers: { "content-security-policy": csp },
    })
    await sendResponse(
      new NodeNextRequest(req as never),
      new NodeNextResponse(res),
      response,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise<string[]>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: `/lab/dvwa${dvwaPath}` }, (res) => {
          const values: string[] = []
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            if (res.rawHeaders[i].toLowerCase() === "content-security-policy") {
              values.push(res.rawHeaders[i + 1])
            }
          }
          res.resume()
          res.on("end", () => resolve(values))
        })
        .on("error", reject)
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe("Next sendResponse keeps the DVWA sandbox CSP", () => {
  it.each(["/vulnerabilities/xss_r/", "/vulnerabilities/sqli/"])(
    "%s still sends the sandbox policy",
    async (dvwaPath) => {
      const values = await sentCspHeaders(dvwaPath)
      expect(values).toHaveLength(1)
      expect(values.some((v) => v.includes("sandbox allow-scripts allow-forms allow-modals"))).toBe(true)
      expect(values.join(";")).not.toContain("allow-same-origin")
      expect(values.every((v) => v.includes("frame-ancestors 'self'"))).toBe(true)
    },
  )
})
