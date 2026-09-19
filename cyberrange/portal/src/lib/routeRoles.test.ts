import { requiredRolesForPath, hasRequiredRole, hasAnyRecognizedRole, landingPathForRole } from "./routeRoles"

describe("requiredRolesForPath", () => {
  it("requires admin only for /admin routes", () => {
    expect(requiredRolesForPath("/admin/pods")).toEqual(["admin"])
  })

  it("requires instructor or admin for /instructor routes", () => {
    expect(requiredRolesForPath("/instructor/students/abc")).toEqual(["instructor", "admin"])
  })

  it("returns null for unrestricted routes", () => {
    expect(requiredRolesForPath("/dashboard")).toBeNull()
    expect(requiredRolesForPath("/scenario/06")).toBeNull()
  })

  it("matches the bare section root exactly", () => {
    expect(requiredRolesForPath("/admin")).toEqual(["admin"])
    expect(requiredRolesForPath("/instructor")).toEqual(["instructor", "admin"])
  })

  it("does not treat a same-prefix sibling route as protected", () => {
    expect(requiredRolesForPath("/instructor-notes")).toBeNull()
    expect(requiredRolesForPath("/administration")).toBeNull()
  })
})

describe("hasRequiredRole", () => {
  it("allows a caller whose roles include one of the required roles", () => {
    expect(hasRequiredRole(["student", "instructor"], ["instructor", "admin"])).toBe(true)
  })

  it("denies a caller missing every required role", () => {
    expect(hasRequiredRole(["student"], ["instructor", "admin"])).toBe(false)
  })

  it("denies undefined/empty roles rather than granting access", () => {
    expect(hasRequiredRole(undefined, ["admin"])).toBe(false)
    expect(hasRequiredRole([], ["admin"])).toBe(false)
  })

  it("tolerates extra Keycloak-internal roles alongside the app roles", () => {
    expect(hasRequiredRole(["offline_access", "default-roles-cyber-range", "admin"], ["admin"])).toBe(true)
  })
})

describe("hasAnyRecognizedRole", () => {
  // Review finding (Leo, PR #83): requiredRolesForPath's null for unrestricted
  // paths must not be confused with "any authenticated caller is fine" --
  // this is the separate check for "has at least one of the three app roles
  // at all", used to catch a role-less account on paths with no specific
  // role requirement.
  it("accepts any one of the three recognized app roles", () => {
    expect(hasAnyRecognizedRole(["student"])).toBe(true)
    expect(hasAnyRecognizedRole(["instructor"])).toBe(true)
    expect(hasAnyRecognizedRole(["admin"])).toBe(true)
  })

  it("rejects an authenticated account with none of the three roles", () => {
    expect(hasAnyRecognizedRole([])).toBe(false)
    expect(hasAnyRecognizedRole(["offline_access", "default-roles-cyber-range"])).toBe(false)
    expect(hasAnyRecognizedRole(undefined)).toBe(false)
  })
})

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

  // Review finding (Leo, PR #83): the earlier comment on this function
  // claimed "not a priority order", which was wrong -- this documents the
  // actual admin > instructor > student priority for the (currently
  // team-enforced-only, not type-enforced) case of a multi-role account.
  it("resolves a hypothetical multi-role account by admin > instructor > student priority", () => {
    expect(landingPathForRole(["student", "admin"])).toBe("/admin")
    expect(landingPathForRole(["student", "instructor"])).toBe("/instructor")
    expect(landingPathForRole(["instructor", "admin"])).toBe("/admin")
  })
})
