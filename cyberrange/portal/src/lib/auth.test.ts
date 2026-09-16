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
