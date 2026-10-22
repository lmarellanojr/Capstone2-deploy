// CR-11 / #313: pin poweredByHeader + path-scoped security headers from next.config.mjs.
import { execFileSync } from "child_process"
import path from "path"
import { pathToFileURL } from "url"

const portalDir = path.join(__dirname, "..")

type HeaderRule = {
  source: string
  headers: { key: string; value: string }[]
}

function loadNextConfig(): {
  poweredByHeader: boolean | undefined
  headerRules: HeaderRule[]
} {
  // ts-jest runs CommonJS and cannot import the .mjs config, so load it in a
  // child node process (same pattern as rootRedirect.test.ts).
  const configUrl = pathToFileURL(path.join(portalDir, "next.config.mjs")).href
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const c = (await import(${JSON.stringify(configUrl)})).default;` +
        `const headerRules = c.headers ? await c.headers() : [];` +
        `process.stdout.write(JSON.stringify({ poweredByHeader: c.poweredByHeader, headerRules }))`,
    ],
    { encoding: "utf8" }
  )
  return JSON.parse(out)
}

describe("next.config security headers (CR-11 / #313)", () => {
  it("disables X-Powered-By and declares path-scoped framing headers", () => {
    const { poweredByHeader, headerRules } = loadNextConfig()
    expect(poweredByHeader).toBe(false)

    const defaultRule = headerRules.find((r) => r.source === "/((?!lab/dvwa(?:/|$)).*)")
    const labExact = headerRules.find((r) => r.source === "/lab/dvwa")
    const labNested = headerRules.find((r) => r.source === "/lab/dvwa/:path*")
    expect(defaultRule).toBeDefined()
    expect(labExact).toBeDefined()
    expect(labNested).toBeDefined()

    expect(defaultRule!.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ])
    )
    expect(defaultRule!.headers).toHaveLength(4)

    for (const labRule of [labExact!, labNested!]) {
      expect(labRule.headers).toEqual(
        expect.arrayContaining([
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ])
      )
      expect(labRule.headers).toHaveLength(3)
      expect(labRule.headers.some((h) => h.key.toLowerCase() === "content-security-policy")).toBe(false)
    }

    // Use Next's matcher to verify the exclusion is segment-bounded.
    const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match")
    const matches = getPathMatch(defaultRule!.source, { strict: true })
    for (const p of ["/lab/dvwa", "/lab/dvwa/", "/lab/dvwa/vulnerabilities/xss_r/"]) expect(matches(p)).toBe(false)
    for (const p of ["/login", "/lab/dvwaevil", "/lab/dvwa-theme", "/dashboard/"]) expect(matches(p)).not.toBe(false)
    expect(headerRules.indexOf(defaultRule!)).toBeLessThan(headerRules.indexOf(labExact!))
  })
})
