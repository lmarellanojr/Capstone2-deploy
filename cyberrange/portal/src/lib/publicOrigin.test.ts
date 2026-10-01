import { isUnusableHost, publicOrigin } from "./publicOrigin"

function req(headers: Record<string, string>, origin = "http://portal.internal:3000") {
  return {
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    nextUrl: { origin },
  }
}

describe("publicOrigin (GAP-11: no hardcoded lab IP)", () => {
  it("prefers the forwarded host and protocol the browser used", () => {
    expect(publicOrigin(req({ "x-forwarded-host": "cyberrange.example.edu", "x-forwarded-proto": "https", host: "10.0.0.5:3000" }))).toBe(
      "https://cyberrange.example.edu"
    )
  })

  it("falls back to the Host header", () => {
    expect(publicOrigin(req({ host: "range.local:3000" }))).toBe("http://range.local:3000")
  })

  it("uses NEXTAUTH_URL when the headers only carry the dev listen address", () => {
    expect(publicOrigin(req({ host: "0.0.0.0:3000" }), "https://portal.example.edu/")).toBe("https://portal.example.edu")
  })

  it("last resort is the request's own origin, never a hardcoded IP", () => {
    expect(publicOrigin(req({}, "http://portal.internal:3000"), undefined)).toBe("http://portal.internal:3000")
    expect(publicOrigin(req({ host: "0.0.0.0:3000" }, "http://0.0.0.0:3000"), undefined)).toBe("http://localhost:3000")
  })

  it("never returns the old 10.115.77.12 fallback on its own", () => {
    expect(publicOrigin(req({}, "https://elsewhere.example"), undefined)).not.toContain("10.115.77.12")
  })
})

describe("isUnusableHost", () => {
  it.each([[undefined], [null], [""], ["0.0.0.0"], ["0.0.0.0:3000"], ["http://0.0.0.0:3000/x"]])("rejects %p", (h) => {
    expect(isUnusableHost(h as string | null | undefined)).toBe(true)
  })

  it.each([["localhost:3000"], ["10.115.77.12"], ["https://cyberrange.example.edu"]])("accepts %p", (h) => {
    expect(isUnusableHost(h)).toBe(false)
  })
})
