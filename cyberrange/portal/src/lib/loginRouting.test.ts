import { landingPathForRole, shouldHonorCallbackUrl } from "./loginRouting"

describe("landingPathForRole", () => {
  it("maps each single role to its portal", () => {
    expect(landingPathForRole(["admin"])).toBe("/admin")
    expect(landingPathForRole(["instructor"])).toBe("/instructor")
    expect(landingPathForRole(["student"])).toBe("/dashboard")
  })

  it("returns null for no recognized role", () => {
    expect(landingPathForRole([])).toBeNull()
    expect(landingPathForRole(["offline_access", "default-roles-cyber-range"])).toBeNull()
    expect(landingPathForRole(undefined)).toBeNull()
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
