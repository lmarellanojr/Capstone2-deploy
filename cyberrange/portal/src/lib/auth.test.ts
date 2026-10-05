import { authOptions } from "./auth"

// Regression test for PR review comment (jabez-shekinah): a NextAuth session
// cookie created before role extraction shipped has no token.roles at all.
// Its access token can still be well within its valid window, in which case
// the jwt() callback's "still valid -> reuse" branch used to return the
// token completely unchanged -- session.user.roles stayed [] until the next
// refresh or a full re-login, even though the stored access token already
// carried the real realm_access.roles claim.

function fakeAccessToken(roles: string[]): string {
  const payload = Buffer.from(JSON.stringify({ realm_access: { roles } })).toString(
    "base64url"
  )
  return `header.${payload}.sig`
}

const jwtCallback = authOptions.callbacks!.jwt as (args: {
  token: any
  account?: any
}) => Promise<any>

describe("jwt callback / roles backfill", () => {
  it("backfills roles for a pre-existing session without touching accessToken", async () => {
    // Shape of a real session cookie minted before this change: has
    // accessToken/accessTokenExpires, but no `roles` key at all.
    const preExistingToken = {
      accessToken: fakeAccessToken(["admin"]),
      refreshToken: "refresh-abc",
      accessTokenExpires: Date.now() + 2 * 60_000, // still valid for 2 more minutes
    }

    const result = await jwtCallback({ token: preExistingToken, account: undefined })

    expect(result.roles).toEqual(["admin"])
    // Must be the "reuse" path, not a refresh -- accessToken is untouched.
    expect(result.accessToken).toBe(preExistingToken.accessToken)
  })

  it("sets roles from the access token on initial sign-in", async () => {
    const token: any = {}
    const account = {
      access_token: fakeAccessToken(["instructor"]),
      refresh_token: "refresh-xyz",
      expires_in: 300,
    }

    const result = await jwtCallback({ token, account })

    expect(result.roles).toEqual(["instructor"])
  })

  it("does not touch roles once already present", async () => {
    const tokenWithRoles = {
      accessToken: fakeAccessToken(["admin"]),
      roles: ["student"], // deliberately stale/different from the token's real claim
      accessTokenExpires: Date.now() + 2 * 60_000,
    }

    const result = await jwtCallback({ token: tokenWithRoles, account: undefined })

    // Backfill only fires when roles is undefined -- an already-set value
    // (from initial sign-in or a prior refresh) is left alone here; it's
    // doRefresh()'s job to re-decode on the next actual refresh cycle.
    expect(result.roles).toEqual(["student"])
  })

  it("backfill safely resolves to [] when there is no access token to decode", async () => {
    const tokenWithNoAccessToken = {
      accessTokenExpires: Date.now() + 2 * 60_000,
    }

    const result = await jwtCallback({ token: tokenWithNoAccessToken, account: undefined })

    expect(result.roles).toEqual([])
  })
})

// Logout without id_token_hint makes Keycloak show "Do you want to log out?".
// The id_token is kept in the server-side JWT for federated-logout, and is
// never copied into the session object the browser can read.
describe("id_token for logout", () => {
  const sessionCallback = authOptions.callbacks!.session as (args: { session: any; token: any }) => Promise<any>

  it("stores the id_token on initial sign-in", async () => {
    const account = { access_token: fakeAccessToken(["student"]), refresh_token: "r", id_token: "id-token-abc", expires_in: 300 }
    const result = await jwtCallback({ token: {}, account })
    expect(result.idToken).toBe("id-token-abc")
  })

  it("keeps the id_token on the reuse path", async () => {
    const token = { accessToken: fakeAccessToken(["student"]), roles: ["student"], idToken: "id-1", accessTokenExpires: Date.now() + 2 * 60_000 }
    const result = await jwtCallback({ token, account: undefined })
    expect(result.idToken).toBe("id-1")
  })

  it("never exposes the id_token in the session", async () => {
    const session = await sessionCallback({
      session: { user: { name: "student_demo" } },
      token: { accessToken: "a", idToken: "id-secret", roles: ["student"] },
    })
    expect(JSON.stringify(session)).not.toContain("id-secret")
  })
})
