// CR-11: the route owns DVWA CSP; Next must deliver it without a config collision.
import { execFileSync } from "child_process"
import http from "http"
import path from "path"
import { pathToFileURL } from "url"
import type { AddressInfo } from "net"
import { sendResponse } from "next/dist/server/send-response"
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node"
import { dvwaContentSecurityPolicy } from "./lib/dvwaProxy"

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

// Load the real config rules (ts-jest cannot import .mjs directly).
function loadHeaderRules(): HeaderRule[] {
  const configUrl = pathToFileURL(path.join(__dirname, "..", "next.config.mjs")).href
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const c = (await import(${JSON.stringify(configUrl)})).default;` +
        `process.stdout.write(JSON.stringify(c.headers ? await c.headers() : []))`,
    ],
    { encoding: "utf8" },
  )
  return JSON.parse(out)
}

const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match")
const headerRules = loadHeaderRules()

async function sentCspHeaders(dvwaPath: string): Promise<string[]> {
  // Simulate an iframe request: sandbox applies only for Sec-Fetch-Dest iframe.
  const csp = dvwaContentSecurityPolicy(dvwaPath, { iframe: true })
  if (!csp.includes('sandbox')) throw new Error(`no sandbox CSP for ${dvwaPath}`)
  const server = http.createServer(async (req, res) => {
    // Precondition: apply every config header whose rule matches this path,
    // as Next does before the route runs. A config CSP here must not win.
    // Next's built header routes accept an optional trailing slash.
    const pathname = req.url!.split("?")[0].replace(/(.)\/$/, "$1")
    for (const rule of headerRules) {
      if (getPathMatch(rule.source, { strict: true })(pathname) === false) continue
      for (const h of rule.headers) res.setHeader(h.key, h.value)
    }
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
