// SEC-02 (#54): portal side of "an Instructor cannot perform Admin operations".
// SEC-01 (middleware.test.ts, apiProxy.test.ts) already covers the page
// redirects and the generic proxy rules; this file adds only what SEC-02 owns:
//   - the real force-destroy proxy route, called with an Instructor session,
//     returns the backend's 403 unchanged and sends only the Instructor's token
//   - the /api/admin surface is exactly what SEC-02 covers (a new Admin proxy
//     route fails here until it gets denial coverage)
//   - Admin controls are not offered outside the Admin section. The backend
//     denies regardless (test_sec02_instructor_admin_denial.py); this only
//     confirms nothing in the Instructor UI invites the attempt.
import fs from "fs"
import path from "path"
import { NextRequest } from "next/server"

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }))
jest.mock("@/lib/auth", () => ({ authOptions: {} }))
import { getServerSession } from "next-auth"
import { DELETE as forceDestroy } from "@/app/api/admin/pods/[id]/force-destroy/route"
import { GET as listUsers, POST as createUser } from "@/app/api/admin/users/route"
import { PATCH as setEnabled } from "@/app/api/admin/users/[id]/enabled/route"
import { PUT as setRole } from "@/app/api/admin/users/[id]/role/route"
import { PUT as resetPassword } from "@/app/api/admin/users/[id]/password/route"
import { DELETE as resetMfa } from "@/app/api/admin/users/[id]/mfa/route"
import { GET as auditLog } from "@/app/api/admin/audit-log/route"
import { adminNavItems, instructorNavItems } from "./navigation"
import { hasRequiredRole, requiredRolesForPath } from "./routeRoles"

const mockedSession = getServerSession as jest.MockedFunction<typeof getServerSession>
const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

const FORBIDDEN = { detail: "Forbidden: Insufficient privileges" }
const SRC = path.join(__dirname, "..")

function instructorRequest(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, "https://cyberrange.example.test"), { method: "DELETE", headers })
}

beforeEach(() => {
  fetchMock.mockReset()
  mockedSession.mockReset()
  mockedSession.mockResolvedValue({ accessToken: "instructor-session-token", user: { roles: ["instructor"] } } as never)
})

describe("force-destroy proxy route with an Instructor session", () => {
  it("returns the backend's 403 unchanged", async () => {
    fetchMock.mockResolvedValueOnce({ status: 403, json: async () => FORBIDDEN } as Response)
    const res = await forceDestroy(instructorRequest("/api/admin/pods/5/force-destroy"), { params: Promise.resolve({ id: "5" }) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(FORBIDDEN)
  })

  it("makes exactly one upstream call, with the Instructor's own token and no forged role", async () => {
    fetchMock.mockResolvedValueOnce({ status: 403, json: async () => FORBIDDEN } as Response)
    await forceDestroy(
      instructorRequest("/api/admin/pods/5/force-destroy", {
        authorization: "Bearer stolen-admin-token",
        "x-roles": "admin",
        "x-forwarded-user": "admin_demo",
      }),
      { params: Promise.resolve({ id: "5" }) }
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/admin\/pods\/5\/force-destroy$/)
    expect(init.method).toBe("DELETE")
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer instructor-session-token" })
    expect(init.body).toBeUndefined()
  })

  it("does not retry or fall back to another route after a denial", async () => {
    fetchMock.mockResolvedValue({ status: 403, json: async () => FORBIDDEN } as Response)
    await forceDestroy(instructorRequest("/api/admin/pods/5/force-destroy"), { params: Promise.resolve({ id: "5" }) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// --- ADM-USER proxy routes with an Instructor session -------------------------

const USER_ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"

function jsonRequest(pathname: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, "https://cyberrange.example.test"), {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const FORGED = { authorization: "Bearer stolen-admin-token", "x-roles": "admin", "x-forwarded-user": "admin_demo" }

describe("user-management proxy routes with an Instructor session", () => {
  const cases: {
    name: string
    upstream: RegExp
    method: string
    call: () => Promise<Response>
  }[] = [
    {
      name: "GET /api/admin/users",
      upstream: /\/admin\/users\?search=ana$/,
      method: "GET",
      call: () => listUsers(jsonRequest("/api/admin/users?search=ana&evil=1", "GET", undefined, FORGED)),
    },
    {
      name: "POST /api/admin/users",
      upstream: /\/admin\/users$/,
      method: "POST",
      call: () =>
        createUser(
          jsonRequest("/api/admin/users", "POST", { username: "evil", role: "admin", password: "x".repeat(12) }, FORGED)
        ),
    },
    {
      name: "PATCH /api/admin/users/{id}/enabled",
      upstream: new RegExp(`/admin/users/${USER_ID}/enabled$`),
      method: "PATCH",
      call: () =>
        setEnabled(jsonRequest(`/api/admin/users/${USER_ID}/enabled`, "PATCH", { enabled: false }, FORGED), {
          params: Promise.resolve({ id: USER_ID }),
        }),
    },
    {
      name: "PUT /api/admin/users/{id}/role",
      upstream: new RegExp(`/admin/users/${USER_ID}/role$`),
      method: "PUT",
      call: () =>
        setRole(jsonRequest(`/api/admin/users/${USER_ID}/role`, "PUT", { role: "admin" }, FORGED), {
          params: Promise.resolve({ id: USER_ID }),
        }),
    },
    {
      name: "PUT /api/admin/users/{id}/password",
      upstream: new RegExp(`/admin/users/${USER_ID}/password$`),
      method: "PUT",
      call: () =>
        resetPassword(
          jsonRequest(`/api/admin/users/${USER_ID}/password`, "PUT", { password: "Probe!12345", temporary: false }, FORGED),
          { params: Promise.resolve({ id: USER_ID }) }
        ),
    },
    {
      name: "DELETE /api/admin/users/{id}/mfa",
      upstream: new RegExp(`/admin/users/${USER_ID}/mfa$`),
      method: "DELETE",
      call: () =>
        resetMfa(jsonRequest(`/api/admin/users/${USER_ID}/mfa`, "DELETE", undefined, FORGED), {
          params: Promise.resolve({ id: USER_ID }),
        }),
    },
    {
      name: "GET /api/admin/audit-log",
      upstream: /\/admin\/audit-log\?event_type=ADMIN_USER_ROLE_SET$/,
      method: "GET",
      call: () => auditLog(jsonRequest("/api/admin/audit-log?event_type=ADMIN_USER_ROLE_SET&drop=1", "GET", undefined, FORGED)),
    },
  ]

  it.each(cases)("$name returns the backend's 403 unchanged", async ({ call }) => {
    fetchMock.mockResolvedValue({ status: 403, json: async () => FORBIDDEN } as Response)
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(FORBIDDEN)
  })

  it.each(cases)("$name makes one upstream call with only the Instructor's own token", async ({ call, upstream, method }) => {
    fetchMock.mockResolvedValue({ status: 403, json: async () => FORBIDDEN } as Response)
    await call()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(upstream)
    expect(init.method).toBe(method)
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer instructor-session-token" })
  })

  it("rejects a non-UUID user id before any upstream call", async () => {
    const res = await setRole(jsonRequest("/api/admin/users/..%2Fpods/role", "PUT", { role: "admin" }), {
      params: Promise.resolve({ id: "../pods" }),
    })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a non-UUID user id on the MFA reset route before any upstream call", async () => {
    const res = await resetMfa(jsonRequest("/api/admin/users/..%2Fpods/mfa", "DELETE"), {
      params: Promise.resolve({ id: "../pods" }),
    })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// --- /api/admin surface ------------------------------------------------------

function routesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (fs.existsSync(path.join(dir, e.name, "route.ts"))) out.push(rel)
    out.push(...routesUnder(path.join(dir, e.name), rel))
  }
  return out
}

describe("/api/admin surface", () => {
  it("is exactly the routes SEC-02 covers", () => {
    // User/role management (ADM-USER #32) is now proxied for the Admin Users
    // page; its Instructor-denial coverage is the block above. Adding any
    // other proxy route here must come with an Instructor-denial test too.
    expect(routesUnder(path.join(SRC, "app", "api", "admin"))).toEqual([
      "audit-log",
      "infra-health",
      "pods/[id]/force-destroy",
      "users",
      "users/[id]/enabled",
      "users/[id]/mfa",
      "users/[id]/password",
      "users/[id]/role",
    ])
  })
})

// --- Admin controls stay in the Admin section ----------------------------------

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [full] : []
  })
}

describe("Admin controls are not offered to Instructors", () => {
  it("the Instructor sidebar has no Admin links", () => {
    expect(instructorNavItems.length).toBeGreaterThan(0)
    expect(instructorNavItems.filter((i) => i.href === "/admin" || i.href.startsWith("/admin/"))).toEqual([])
    // The Admin sidebar may link outside /admin (it offers the Instructor view,
    // which admins are allowed on), but never to a page an Admin is denied.
    // Checked against routeRoles.ts, the same table middleware enforces.
    expect(adminNavItems.some((i) => i.href.startsWith("/admin"))).toBe(true)
    const deniedToAdmin = adminNavItems.filter((i) => {
      const required = requiredRolesForPath(i.href)
      return required !== null && !hasRequiredRole(["admin"], required)
    })
    expect(deniedToAdmin).toEqual([])
  })

  it("no Instructor page links to an Admin page or calls an Admin operation", () => {
    const files = sourceFiles(path.join(SRC, "app", "instructor"))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, "utf8")
      return /["'`]\/admin(\/|["'`])|forceDestroyPod|adminNavItems|\/api\/admin/.test(src)
    })
    expect(offenders).toEqual([])
  })

  it("forceDestroyPod is only called from Admin pages", () => {
    const callers = sourceFiles(SRC).filter(
      (f) => !f.endsWith(path.join("lib", "api.ts")) && fs.readFileSync(f, "utf8").includes("forceDestroyPod")
    )
    expect(callers.length).toBeGreaterThan(0)
    expect(callers.filter((f) => !f.includes(`${path.sep}app${path.sep}admin${path.sep}`))).toEqual([])
  })
})
