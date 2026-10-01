import { isAcceptedType, MAX_UPLOAD_BYTES, prepareScreenshot, ScreenshotError } from "./imageCompress"

describe("prepareScreenshot", () => {
  it("accepts only PNG, JPEG and WebP", () => {
    expect(isAcceptedType("image/png")).toBe(true)
    expect(isAcceptedType("image/jpeg")).toBe(true)
    expect(isAcceptedType("image/webp")).toBe(true)
    expect(isAcceptedType("image/svg+xml")).toBe(false)
    expect(isAcceptedType("image/gif")).toBe(false)
  })

  it("rejects other types before reading them", async () => {
    const svg = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })
    await expect(prepareScreenshot(svg)).rejects.toBeInstanceOf(ScreenshotError)
  })

  it("sends small images untouched", async () => {
    const small = new File([new Uint8Array(1000)], "shot.png", { type: "image/png" })
    const { blob, name } = await prepareScreenshot(small)
    expect(blob).toBe(small)
    expect(name).toBe("shot.png")
    expect(small.size).toBeLessThan(MAX_UPLOAD_BYTES)
  })
})
