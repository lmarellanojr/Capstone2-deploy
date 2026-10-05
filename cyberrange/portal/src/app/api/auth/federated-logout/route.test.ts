import { NextRequest } from "next/server"

jest.mock("next-auth/jwt", () => ({ getToken: jest.fn() }))
import { getToken } from "next-auth/jwt"
import { GET } from "./route"

const mockedGetToken = getToken as jest.MockedFunction<typeof getToken>
const ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ENV, NEXTAUTH_URL: "https://range.example.test", KEYCLOAK_PUBLIC_ISSUER: "https://range.example.test/auth/realms/cyber-range", KEYCLOAK_CLIENT_ID: "portal" }
  mockedGetToken.mockReset()
})
afterAll(() => {
  process.env = ENV
})

function logout(cookie?: string) {
  return GET(
    new NextRequest(new URL("/api/auth/federated-logout", "https://range.example.test"), {
      headers: cookie ? { cookie } : {},
    })
  )
}

describe("federated logout", () => {
  it("sends id_token_hint so Keycloak logs out without a confirmation page", async () => {
    mockedGetToken.mockResolvedValue({ idToken: "id-token-abc" } as never)
    const res = await logout()
    const target = new URL(res.headers.get("location")!)
    expect(target.pathname).toBe("/auth/realms/cyber-range/protocol/openid-connect/logout")
    expect(target.searchParams.get("id_token_hint")).toBe("id-token-abc")
    expect(target.searchParams.get("client_id")).toBe("portal")
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe("https://range.example.test")
  })

  it("still redirects to Keycloak logout when there is no session", async () => {
    mockedGetToken.mockResolvedValue(null)
    const target = new URL((await logout()).headers.get("location")!)
    expect(target.pathname).toMatch(/\/protocol\/openid-connect\/logout$/)
    expect(target.searchParams.has("id_token_hint")).toBe(false)
  })

  it("ends the portal session in the same response (every chunk of the session cookie)", async () => {
    mockedGetToken.mockResolvedValue({ idToken: "id-token-abc" } as never)
    const res = await logout(
      "__Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.1=b; next-auth.callback-url=x; theme=dark"
    )
    const cleared = res.cookies.getAll().filter((c) => c.value === "" && c.maxAge === 0).map((c) => c.name).sort()
    expect(cleared).toEqual(["__Secure-next-auth.session-token.0", "__Secure-next-auth.session-token.1"])
    // unrelated cookies are left alone
    expect(res.cookies.get("theme")).toBeUndefined()
  })
})
