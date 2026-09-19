import { evaluateDestroyPollTick } from "./useAdminDestroyPoll"

const FIVE_MIN_MS = 5 * 60 * 1000

describe("evaluateDestroyPollTick", () => {
  it("continues polling on a non-terminal status well within the timeout", () => {
    expect(evaluateDestroyPollTick(0, { status: "DESTROYING" })).toEqual({ action: "continue" })
    expect(evaluateDestroyPollTick(FIVE_MIN_MS - 5000, { status: "DESTROYING" })).toEqual({
      action: "continue",
    })
  })

  it("stops with 'destroyed' as soon as status is DESTROYED", () => {
    expect(evaluateDestroyPollTick(2500, { status: "DESTROYED" })).toEqual({ action: "destroyed" })
  })

  // Leo's original finding: perform_destruction can leave a pod in
  // DESTROYING indefinitely on a partial LXD failure (provision.py:383-391).
  it("gives up once the elapsed time passes the threshold, even while still DESTROYING", () => {
    const outcome = evaluateDestroyPollTick(FIVE_MIN_MS + 1, { status: "DESTROYING" })
    expect(outcome.action).toBe("give-up")
    expect((outcome as { message: string }).message).toMatch(/taking longer than expected/i)
  })

  it("continues polling through a transient 503 well within the timeout", () => {
    const outcome = evaluateDestroyPollTick(10_000, {
      error: { isAxiosError: true, response: { status: 503 } },
    })
    expect(outcome).toEqual({ action: "continue" })
  })

  // Leo's follow-up finding: the timeout previously only lived on the
  // success path, so a run of persistent 5xx/network errors never reached
  // it. elapsedMs is checked first, unconditionally, regardless of what this
  // tick's result was -- this must give up exactly like the DESTROYING case.
  it("gives up past the threshold even when every tick is a persistent transient error", () => {
    const outcome = evaluateDestroyPollTick(FIVE_MIN_MS + 1, {
      error: { isAxiosError: true, response: { status: 503 } },
    })
    expect(outcome.action).toBe("give-up")
    expect((outcome as { message: string }).message).toMatch(/taking longer than expected/i)
  })

  it("gives up immediately on a non-transient error (404) without waiting for the timeout", () => {
    const outcome = evaluateDestroyPollTick(2500, {
      error: { isAxiosError: true, response: { status: 404 } },
    })
    expect(outcome.action).toBe("give-up")
    expect((outcome as { message: string }).message).toMatch(/pod not found/i)
  })

  it("gives up immediately on a non-transient, non-404 error", () => {
    const outcome = evaluateDestroyPollTick(2500, {
      error: { isAxiosError: true, response: { status: 400 } },
    })
    expect(outcome.action).toBe("give-up")
    expect((outcome as { message: string }).message).toMatch(/could not confirm teardown/i)
  })
})
