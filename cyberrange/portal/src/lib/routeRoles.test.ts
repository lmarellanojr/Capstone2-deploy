import { requiredRolesForPath, hasRequiredRole, hasAnyRecognizedRole, landingPathForRole, redirectPathForRole, onboardingRedirectPath } from "./routeRoles"

describe("onboardingRedirectPath", () => {
  it("redirects incomplete recognized-role users and preserves the query string", () => {
    expect(onboardingRedirectPath("/scenarios", "?tab=defensive&tag=one", ["student"], false))
      .toBe("/orientation?returnTo=%2Fscenarios%3Ftab%3Ddefensive%26tag%3Done")
  })

  it.each(["/orientation", "/login", "/no-role", "/auth-error"])("allows %s without an onboarding API check", (path) => {
    expect(onboardingRedirectPath(path, "", ["student"], false)).toBeNull()
  })

  it("does not check completed or role-less accounts", () => {
    expect(onboardingRedirectPath("/dashboard", "", ["student"], true)).toBeNull()
    expect(onboardingRedirectPath("/dashboard", "", [], false)).toBeNull()
  })

  it("skips admins but still sends new instructors and students", () => {
    expect(onboardingRedirectPath("/admin", "", ["admin"], false)).toBeNull()
    expect(onboardingRedirectPath("/instructor", "", ["instructor", "admin"], false)).toBeNull()
    expect(onboardingRedirectPath("/instructor", "", ["instructor"], false))
      .toBe("/orientation?returnTo=%2Finstructor")
    expect(onboardingRedirectPath("/dashboard", "", ["student"], false))
      .toBe("/orientation?returnTo=%2Fdashboard")
  })
})

describe("redirectPathForRole", () => {
  it.each([
    ["/dashboard", ["student"], null],
    ["/dashboard/", ["instructor"], "/instructor"],
    ["/dashboard", ["student", "admin"], "/admin"],
    ["/dashboard", ["student", "instructor"], "/instructor"],
    ["/dashboard", [], "/no-role"],
    ["/admin/users", ["instructor"], "/instructor"],
    ["/instructor/students", ["admin"], null],
    ["/scenario/2", ["instructor"], null],
    ["/dashboard/history", ["admin"], null],
    ["/dashboard-other", ["admin"], null],
  ] as [string, string[], string | null][])("%s for %j redirects to %s", (path, roles, expected) => {
    expect(redirectPathForRole(path, roles)).toBe(expected)
    if (expected && expected !== "/no-role") {
      expect(redirectPathForRole(expected, roles)).toBeNull()
    }
  })
})

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
