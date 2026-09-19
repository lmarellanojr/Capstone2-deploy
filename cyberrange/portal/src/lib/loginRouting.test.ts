import { shouldHonorCallbackUrl, resolveSameOriginPath } from "./loginRouting"

const ORIGIN = "https://cyberrange.example"

describe("resolveSameOriginPath", () => {
  // Leo's finding (PR #83): callbackUrl reached router.push unvalidated --
  // an open redirect via Next's cross-origin full-page navigation. These are
  // the exact three forms he listed.
  it("rejects an absolute cross-origin URL", () => {
    expect(resolveSameOriginPath("https://evil.example", ORIGIN)).toBeNull()
  })

  it("rejects a protocol-relative URL", () => {
    expect(resolveSameOriginPath("//evil.example", ORIGIN)).toBeNull()
  })

  it("rejects a backslash variant that normalizes to protocol-relative", () => {
    expect(resolveSameOriginPath("/\\evil.example", ORIGIN)).toBeNull()
  })

  it("accepts a genuine same-origin path and strips the origin from the result", () => {
    expect(resolveSameOriginPath("/scenario/06", ORIGIN)).toBe("/scenario/06")
    expect(resolveSameOriginPath("/instructor/students?x=1", ORIGIN)).toBe("/instructor/students?x=1")
  })

  it("returns null for missing or empty input", () => {
    expect(resolveSameOriginPath(null, ORIGIN)).toBeNull()
    expect(resolveSameOriginPath("", ORIGIN)).toBeNull()
  })
})

describe("shouldHonorCallbackUrl", () => {
  // Leo's finding (PR #83): the sign-out flow always injects
  // callbackUrl=/dashboard (federated-logout -> "/" -> redirect("/dashboard")
  // -> middleware, no token -> /login?callbackUrl=/dashboard), regardless of
  // the account's role. That generic default must never override a
  // role-specific landing path.
  it("never honors the generic default, for any role", () => {
    expect(shouldHonorCallbackUrl("/dashboard", ["instructor"])).toBe(false)
    expect(shouldHonorCallbackUrl("/dashboard", ["admin"])).toBe(false)
    expect(shouldHonorCallbackUrl("/dashboard", ["student"])).toBe(false)
    expect(shouldHonorCallbackUrl("/", ["admin"])).toBe(false)
  })

  it("honors an unrestricted deep-link target regardless of role", () => {
    expect(shouldHonorCallbackUrl("/scenario/06", ["student"])).toBe(true)
    expect(shouldHonorCallbackUrl("/settings", ["admin"])).toBe(true)
  })

  it("honors a role-restricted target only when the role actually satisfies it", () => {
    expect(shouldHonorCallbackUrl("/instructor/students", ["instructor"])).toBe(true)
    expect(shouldHonorCallbackUrl("/instructor/students", ["admin"])).toBe(true)
    expect(shouldHonorCallbackUrl("/instructor/students", ["student"])).toBe(false)
    expect(shouldHonorCallbackUrl("/admin/pods", ["admin"])).toBe(true)
    expect(shouldHonorCallbackUrl("/admin/pods", ["instructor"])).toBe(false)
  })
})
