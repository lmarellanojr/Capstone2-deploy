import { requiredRolesForPath, hasRequiredRole } from "./routeRoles"

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
