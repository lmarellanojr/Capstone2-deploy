// SEC-01 (#36): page-level RBAC matrix for middleware.ts (AUTH-04/AUTH-05).
// routeRoles.test.ts covers the helper functions; this exercises the actual
// middleware decision a browser gets for each role x protected page, plus
// manual URL attempts, and proves every non-public page is inside the matcher.
import fs from "fs"
import path from "path"
import { NextRequest } from "next/server"

jest.mock("next-auth/jwt", () => ({ getToken: jest.fn() }))
import { getToken } from "next-auth/jwt"
import { config, middleware } from "./middleware"

const mockedGetToken = getToken as jest.MockedFunction<typeof getToken>
const NOISE = ["offline_access", "uma_authorization", "default-roles-cyber-range"]

type Caller = "unauthenticated" | "no_role" | "student" | "instructor" | "admin"
const TOKENS: Record<Caller, Record<string, unknown> | null> = {
  unauthenticated: null,
  no_role: { roles: NOISE },
  student: { roles: ["student", ...NOISE] },
  instructor: { roles: ["instructor", ...NOISE] },
  admin: { roles: ["admin", ...NOISE] },
}

const ORIGIN = "https://cyberrange.example.test"

async function visit(caller: Caller, pathname: string) {
  mockedGetToken.mockResolvedValue(TOKENS[caller] as never)
  const req = new NextRequest(new URL(pathname, ORIGIN), { headers: { host: "cyberrange.example.test", "x-forwarded-proto": "https" } })
  const res = await middleware(req)
  const location = res.headers.get("location")
  if (!location) return "allow"
  const u = new URL(location)
  return u.pathname === "/login" ? `login?callbackUrl=${u.searchParams.get("callbackUrl")}` : u.pathname
}

// Expected outcome per caller: "allow" or the path the browser is redirected to.
const STUDENT_PAGES = ["/dashboard", "/scenarios", "/scenario/2"]
const INSTRUCTOR_PAGES = ["/instructor", "/instructor/students", "/instructor/students/student_demo", "/instructor/reviews", "/instructor/reviews/1"]
const ADMIN_PAGES = ["/admin", "/admin/users", "/admin/pods", "/admin/pods/5", "/admin/system"]

const EXPECT: Record<string, Record<Caller, string>> = {
  student: { unauthenticated: "login", no_role: "/no-role", student: "allow", instructor: "allow", admin: "allow" },
  instructor: { unauthenticated: "login", no_role: "/no-role", student: "/dashboard", instructor: "allow", admin: "allow" },
  admin: { unauthenticated: "login", no_role: "/no-role", student: "/dashboard", instructor: "/dashboard", admin: "allow" },
}

const CASES: [string, string][] = [
  ...STUDENT_PAGES.map((p): [string, string] => [p, "student"]),
  ...INSTRUCTOR_PAGES.map((p): [string, string] => [p, "instructor"]),
  ...ADMIN_PAGES.map((p): [string, string] => [p, "admin"]),
]
const CALLERS = Object.keys(TOKENS) as Caller[]

describe("page RBAC matrix (middleware.ts)", () => {
  describe.each(CASES)("%s (%s page)", (pathname, section) => {
    it.each(CALLERS)("%s", async (caller) => {
      const want = EXPECT[section][caller]
      const got = await visit(caller, pathname)
      if (want === "login") {
        // Unauthenticated: back to /login, remembering where they were going.
        expect(got).toBe(`login?callbackUrl=${pathname}`)
      } else {
        expect(got).toBe(want)
      }
    })
  })
})

describe("manual URL attempts", () => {
  it("query string and trailing slash do not dodge the admin check", async () => {
    for (const p of ["/admin?role=admin", "/admin/users?as=admin", "/admin/", "/admin/users/"]) {
      expect(await visit("student", p)).toBe("/dashboard")
      expect(await visit("instructor", p)).toBe("/dashboard")
    }
  })

  it("a same-prefix sibling is not mistaken for the protected section", async () => {
    // Guards against a naive startsWith("/admin"): /administrator is not /admin.
    expect(await visit("student", "/administrator")).toBe("allow")
  })

  it("roles are read only from the session token, never from the request", async () => {
    mockedGetToken.mockResolvedValue(TOKENS.student as never)
    const req = new NextRequest(new URL("/admin/users?roles=admin", ORIGIN), {
      headers: { host: "cyberrange.example.test", "x-roles": "admin", cookie: "roles=admin" },
    })
    const res = await middleware(req)
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard")
  })

  it("an unauthenticated deep link keeps its query in callbackUrl", async () => {
    expect(await visit("unauthenticated", "/admin/pods/5?tab=logs")).toBe("login?callbackUrl=/admin/pods/5?tab=logs")
  })
})

// --- inventory: every non-public page must be inside config.matcher ----------

const PUBLIC_PAGES = new Set(["/", "/login", "/no-role", "/auth-error"])

function pageRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "api" || entry.name.startsWith("_")) continue
    const seg = entry.name.startsWith("(") ? "" : `/${entry.name}`
    const full = path.join(dir, entry.name)
    if (fs.existsSync(path.join(full, "page.tsx"))) out.push(prefix + seg || "/")
    out.push(...pageRoutes(full, prefix + seg))
  }
  return out
}

function matcherCovers(route: string): boolean {
  // Next's "/section/:path*" matches /section and everything under it.
  return config.matcher.some((m) => {
    const base = m.replace(/\/:path\*$/, "")
    return route === base || route.startsWith(`${base}/`)
  })
}

describe("matcher inventory", () => {
  const appDir = path.join(__dirname, "app")
  const routes = [...pageRoutes(appDir), ...(fs.existsSync(path.join(appDir, "page.tsx")) ? ["/"] : [])]

  it("finds the app's pages (guards against a vacuous pass)", () => {
    expect(routes).toEqual(expect.arrayContaining(["/admin/users", "/instructor/students", "/dashboard"]))
  })

  it("covers every non-public page", () => {
    const uncovered = routes.filter((r) => !PUBLIC_PAGES.has(r) && !matcherCovers(r))
    expect(uncovered).toEqual([])
  })

  it("does not put the public pages behind auth (would loop /login or /no-role)", () => {
    expect([...PUBLIC_PAGES].filter(matcherCovers)).toEqual([])
  })
})
