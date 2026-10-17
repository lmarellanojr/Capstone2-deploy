// #219: `/` must reach /dashboard as a real HTTP 307. If the root page is
// prerendered, `/` ships NEXT_REDIRECT inside a cached 200 and the client
// router crashes redirecting mid-hydration (React #310). Both guards below
// look redundant next to each other, so pin them.
import { execFileSync } from "child_process"
import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"

const portalDir = path.join(__dirname, "..")

describe("root redirect (#219)", () => {
  it("next.config redirects / to /dashboard as a temporary (307) redirect", () => {
    // ts-jest runs CommonJS and cannot import the .mjs config, so load it in
    // a child node process and call the real redirects().
    const configUrl = pathToFileURL(path.join(portalDir, "next.config.mjs")).href
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const c = (await import(${JSON.stringify(configUrl)})).default;` +
          `process.stdout.write(JSON.stringify(c.redirects ? await c.redirects() : []))`,
      ],
      { encoding: "utf8" }
    )
    expect(JSON.parse(out)).toContainEqual({ source: "/", destination: "/dashboard", permanent: false })
  })

  it("root page is never prerendered", () => {
    const page = fs.readFileSync(path.join(__dirname, "app", "page.tsx"), "utf8")
    expect(page).toMatch(/^export const dynamic = ["']force-dynamic["']/m)
  })
})
