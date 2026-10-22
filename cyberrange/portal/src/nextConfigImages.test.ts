// CR-10 / #312: pin images.unoptimized interim control from next.config.mjs.
import { execFileSync } from "child_process"
import path from "path"
import { pathToFileURL } from "url"

const portalDir = path.join(__dirname, "..")

function loadNextConfig(): { images?: { unoptimized?: boolean } } {
  // ts-jest runs CommonJS and cannot import the .mjs config, so load it in a
  // child node process (same pattern as rootRedirect.test.ts).
  const configUrl = pathToFileURL(path.join(portalDir, "next.config.mjs")).href
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const c = (await import(${JSON.stringify(configUrl)})).default;` +
        `process.stdout.write(JSON.stringify({ images: c.images ?? null }))`,
    ],
    { encoding: "utf8" }
  )
  return JSON.parse(out)
}

describe("next.config images interim (CR-10 / #312)", () => {
  it("disables the Image Optimization API via images.unoptimized", () => {
    const { images } = loadNextConfig()
    expect(images).toEqual({ unoptimized: true })
  })
})
