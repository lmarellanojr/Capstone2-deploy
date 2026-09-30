// SEC-01 (#36): proxy-route RBAC. The portal's /api/* routes make no role
// decision of their own -- they forward the signed-in user's own Keycloak
// token and the FastAPI backend decides (test_sec01_rbac_matrix.py). These
// tests pin down the properties that makes safe: no session -> no upstream
// call; only the session token is forwarded, never a client-supplied header;
// backend denials reach the browser unchanged; and every /api route actually
// goes through the proxy.
import fs from "fs"
import path from "path"
import { NextRequest } from "next/server"

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }))
jest.mock("@/lib/auth", () => ({ authOptions: {} }))
import { getServerSession } from "next-auth"
import { forwardQuery, proxyToApi } from "./apiProxy"

const mockedSession = getServerSession as jest.MockedFunction<typeof getServerSession>
const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

function upstream(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce({ status, json: async () => body } as Response)
}

function req(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, "https://cyberrange.example.test"), { headers })
}

beforeEach(() => {
  fetchMock.mockReset()
  mockedSession.mockReset()
})

describe("proxyToApi", () => {
  it("rejects a request with no session without calling the backend", async () => {
    mockedSession.mockResolvedValue(null)
    const res = await proxyToApi(req("/api/admin/pods/1/force-destroy"), "/admin/pods/1/force-destroy", "DELETE")
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("forwards only the session's own access token, never a client-supplied Authorization header", async () => {
    mockedSession.mockResolvedValue({ accessToken: "student-session-token" } as never)
    upstream(403, { detail: "Forbidden: Insufficient privileges" })
    await proxyToApi(
      req("/api/instructor/students", { authorization: "Bearer stolen-admin-token", "x-roles": "admin" }),
      "/instructor/students",
      "GET"
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer student-session-token" })
  })

  it.each([401, 403, 404, 409])("passes a backend %i through unchanged (a denial is never turned into success)", async (status) => {
    mockedSession.mockResolvedValue({ accessToken: "t" } as never)
    upstream(status, { detail: "denied" })
    const res = await proxyToApi(req("/api/admin/pods/1/force-destroy"), "/admin/pods/1/force-destroy", "DELETE")
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ detail: "denied" })
  })

  it("does not invent success when the backend is unreachable on a protected write", async () => {
    mockedSession.mockResolvedValue({ accessToken: "t" } as never)
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const res = await proxyToApi(req("/api/admin/pods/1/force-destroy"), "/admin/pods/1/force-destroy", "DELETE")
    expect(res.status).toBe(503)
  })

  it("raw mode passes a CSV body and its download headers through untouched", async () => {
    mockedSession.mockResolvedValue({ accessToken: "t" } as never)
    fetchMock.mockResolvedValueOnce({
      status: 200,
      text: async () => "student,score\nabc,50\n",
      headers: new Headers({
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=knowledge_gain_metrics.csv",
        "set-cookie": "must-not-leak=1",
      }),
    } as unknown as Response)
    const res = await proxyToApi(
      req("/api/instructor/export/knowledge-gain?format=csv"),
      "/instructor/export/knowledge-gain?format=csv",
      "GET",
      undefined,
      { raw: true }
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("student,score\nabc,50\n")
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("content-disposition")).toBe("attachment; filename=knowledge_gain_metrics.csv")
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("raw mode still refuses a request with no session", async () => {
    mockedSession.mockResolvedValue(null)
    const res = await proxyToApi(req("/api/instructor/export/knowledge-gain"), "/instructor/export/knowledge-gain", "GET", undefined, { raw: true })
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("forwardQuery", () => {
  it("forwards only allow-listed, non-empty params", () => {
    const r = req("/api/admin/users?search=ana&max=50&evil=1&first=")
    expect(forwardQuery(r, ["search", "first", "max"])).toBe("?search=ana&max=50")
  })

  it("returns an empty string when nothing is allowed through", () => {
    expect(forwardQuery(req("/api/instructor/pods?x=1"), [])).toBe("")
  })
})

// --- inventory: every /api route delegates to the backend -------------------

// Routes that legitimately do not use proxyToApi, each checked here by reason.
const NOT_PROXIED: Record<string, string> = {
  "auth/[...nextauth]": "NextAuth's own handler",
  "auth/federated-logout": "sign-out redirect, no backend data",
  "guac-launch/[podId]": "calls backend /pods/{id}/guac-token with the session token (owner-only on the backend)",
  "guac-websocket": "unused and non-functional (always 404/501); see SEC-01 findings",
}

function apiRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    const full = path.join(dir, e.name)
    if (fs.existsSync(path.join(full, "route.ts"))) out.push(rel)
    out.push(...apiRoutes(full, rel))
  }
  return out
}

describe("/api route inventory", () => {
  const apiDir = path.join(__dirname, "..", "app", "api")
  const routes = apiRoutes(apiDir)

  it("finds the proxy routes (guards against a vacuous pass)", () => {
    expect(routes).toEqual(expect.arrayContaining(["admin/pods/[id]/force-destroy", "instructor/students", "pods/provision"]))
  })

  it("every route either uses proxyToApi or is an explicitly reviewed exception", () => {
    const unreviewed = routes.filter((r) => {
      if (r in NOT_PROXIED) return false
      const src = fs.readFileSync(path.join(apiDir, r, "route.ts"), "utf8")
      return !src.includes("proxyToApi(")
    })
    expect(unreviewed).toEqual([])
  })

  it("the guac-launch exception still requires a session and forwards only the session token", () => {
    const src = fs.readFileSync(path.join(apiDir, "guac-launch/[podId]/route.ts"), "utf8")
    expect(src).toMatch(/if \(!session\)\s*\{\s*return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/)
    expect(src).toContain("Bearer ${session.accessToken}")
  })

  it("progress flag route forwards POST JSON body as 4th proxyToApi argument", () => {
    const src = fs.readFileSync(path.join(apiDir, "progress/[scenarioId]/flag/route.ts"), "utf8")
    expect(src).toMatch(/const body = await req\.json\(\)\.catch\(\(\) => \(\{\}\)\)/)
    expect(src).toMatch(/proxyToApi\(req,\s*`\/progress\/\$\{scenarioId\}\/flag`,\s*"POST",\s*body\)/)
  })
})

describe("proxyToApi binary + passBody (evidence screenshots)", () => {
  it("passes image bytes through with the backend's safety headers", async () => {
    mockedSession.mockResolvedValue({ accessToken: "tok" } as never)
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-internal": "should-not-leak",
      }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response)

    const res = await proxyToApi(req("/api/reviews/5/images/2"), "/reviews/5/images/2", "GET", undefined, { binary: true })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-security-policy")).toContain("sandbox")
    expect(res.headers.get("x-internal")).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it("forwards a multipart body untouched with its own Content-Type", async () => {
    mockedSession.mockResolvedValue({ accessToken: "tok" } as never)
    upstream(200, { id: 1 })
    const body = "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\n\r\nPNG\r\n--b--\r\n"
    const incoming = new NextRequest(new URL("/api/reviews/5/images", "https://cyberrange.example.test"), {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      body,
    })

    await proxyToApi(incoming, "/reviews/5/images", "POST", undefined, { passBody: true })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers["Content-Type"]).toBe("multipart/form-data; boundary=b")
    expect(init.headers["Authorization"]).toBe("Bearer tok")
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body)
  })
})
