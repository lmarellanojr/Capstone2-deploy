import { webcrypto } from "crypto"
import { generatePassword, secureRandomInt } from "./generatePassword"

beforeAll(() => {
  if (!globalThis.crypto?.getRandomValues) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto })
  }
})

describe("generatePassword", () => {
  it("meets the backend's 8–128 length and every character class", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword()
      expect(pw).toHaveLength(14)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[2-9]/)
      expect(pw).toMatch(/[!@#$%*\-_=+]/)
    }
  })

  it("never uses look-alike characters", () => {
    for (let i = 0; i < 200; i++) expect(generatePassword()).not.toMatch(/[0O1lI]/)
  })

  it("never goes below 8 characters", () => {
    expect(generatePassword(4)).toHaveLength(8)
  })

  it("is not predictable across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()))
    expect(seen.size).toBe(50)
  })
})

describe("secureRandomInt", () => {
  it("stays in range", () => {
    for (let i = 0; i < 1000; i++) {
      const v = secureRandomInt(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })
})
