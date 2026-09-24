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
import { adminNavItems, instructorNavItems } from "./navigation"

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
    // User/role management (ADM-USER #32) has no portal proxy route yet: the
    // Admin Users page still shows fixture data, so those operations are only
    // reachable on the backend, where SEC-02 tests them. Adding a proxy route
    // here must come with an Instructor-denial test above.
    expect(routesUnder(path.join(SRC, "app", "api", "admin"))).toEqual([
      "infra-health",
      "pods/[id]/force-destroy",
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
    expect(adminNavItems.every((i) => i.href.startsWith("/admin"))).toBe(true)
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
