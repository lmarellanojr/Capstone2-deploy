import { validateScore, resolveScorePayload } from "./scoreEvaluation"

describe("scoreEvaluation", () => {
  describe("validateScore", () => {
    it("accepts valid integer scores between 0 and 100 for APPROVED", () => {
      expect(validateScore("APPROVED", 0)).toEqual({ valid: true })
      expect(validateScore("APPROVED", 50)).toEqual({ valid: true })
      expect(validateScore("APPROVED", 100)).toEqual({ valid: true })
      expect(validateScore("APPROVED", "85")).toEqual({ valid: true })
    })

    it("rejects empty score for APPROVED", () => {
      expect(validateScore("APPROVED", "").valid).toBe(false)
      expect(validateScore("APPROVED", "").error).toMatch(/valid score between 0 and 100/)
    })

    it("rejects float scores (e.g. 85.5) for APPROVED", () => {
      expect(validateScore("APPROVED", 85.5).valid).toBe(false)
      expect(validateScore("APPROVED", "85.5").valid).toBe(false)
      expect(validateScore("APPROVED", 85.5).error).toMatch(/whole integer/)
    })

    it("rejects out-of-bounds scores for APPROVED", () => {
      expect(validateScore("APPROVED", -1).valid).toBe(false)
      expect(validateScore("APPROVED", 101).valid).toBe(false)
      expect(validateScore("APPROVED", 150).valid).toBe(false)
    })

    it("accepts any or empty score for REJECTED and RETRY", () => {
      expect(validateScore("REJECTED", "")).toEqual({ valid: true })
      expect(validateScore("REJECTED", 90)).toEqual({ valid: true })
      expect(validateScore("RETRY", "")).toEqual({ valid: true })
      expect(validateScore("RETRY", 85.5)).toEqual({ valid: true })
    })
  })

  describe("resolveScorePayload", () => {
    it("derives correct payload and display for APPROVED", () => {
      const res = resolveScorePayload("APPROVED", 95)
      expect(res).toEqual({
        score: 95,
        display: "95 / 100",
      })
    })

    it("strictly sets score to 0 on REJECTED even with pre-filled or typed score", () => {
      expect(resolveScorePayload("REJECTED", "")).toEqual({
        score: 0,
        display: "0 / 100 (rejected)",
      })
      expect(resolveScorePayload("REJECTED", 90)).toEqual({
        score: 0,
        display: "0 / 100 (rejected)",
      })
      expect(resolveScorePayload("REJECTED", "100")).toEqual({
        score: 0,
        display: "0 / 100 (rejected)",
      })
    })

    it("strictly sets score to null on RETRY even with pre-filled or typed score", () => {
      expect(resolveScorePayload("RETRY", "")).toEqual({
        score: null,
        display: "None (retry requested)",
      })
      expect(resolveScorePayload("RETRY", 80)).toEqual({
        score: null,
        display: "None (retry requested)",
      })
      expect(resolveScorePayload("RETRY", "100")).toEqual({
        score: null,
        display: "None (retry requested)",
      })
    })
  })
})
