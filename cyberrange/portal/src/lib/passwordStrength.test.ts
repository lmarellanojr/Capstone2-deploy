import { generatePassword } from "./generatePassword"
import {
  estimatePasswordStrength,
  evaluatePasswordRequirements,
  passwordStrengthLabel,
  passwordStrengthWidth,
} from "./passwordStrength"

describe("estimatePasswordStrength", () => {
  it.each([
    ["", 0],
    ["short", 1],
    ["password123456789", 1],
    ["orchid river copper moon", 2],
    ["r7#k9z2$m", 2],
    ["r7#k9z2$m8%N4", 3],
    ["982!sunshine#731", 4],
    ["#!@#%^23456789!@#%^2", 4],
  ] as const)("scores %j as %i", (value, score) => {
    expect(estimatePasswordStrength(value)).toBe(score)
  })

  it("labels and widths follow the continuous-bar scale", () => {
    expect(passwordStrengthLabel(0)).toMatch(/Enter a new password/)
    expect(passwordStrengthLabel(1)).toBe("Password strength: Weak")
    expect(passwordStrengthLabel(2)).toBe("Password strength: Medium")
    expect(passwordStrengthLabel(4)).toBe("Password strength: Strong")
    expect(passwordStrengthWidth(0)).toBe("0%")
    expect(passwordStrengthWidth(1)).toBe("33%")
    expect(passwordStrengthWidth(4)).toBe("100%")
  })
})

describe("evaluatePasswordRequirements", () => {
  it("tracks only client-checkable length and identity rules", () => {
    const empty = evaluatePasswordRequirements("", { username: "student_demo", email: "student@example.test" })
    expect(empty.find((item) => item.id === "length")?.met).toBe(false)
    expect(empty.find((item) => item.id === "notUsername")?.met).toBe(false)
    expect(empty.find((item) => item.id === "notEmail")?.met).toBe(false)
    expect(empty.some((item) => (item.id as string) === "notCommon")).toBe(false)

    const weak = evaluatePasswordRequirements("short", { username: "student_demo" })
    expect(weak.find((item) => item.id === "length")?.met).toBe(false)

    const sameUser = evaluatePasswordRequirements("student_demo", { username: "student_demo" })
    expect(sameUser.find((item) => item.id === "notUsername")?.met).toBe(false)

    const strong = evaluatePasswordRequirements("#!@#%^23456789!@#%^2", {
      username: "student_demo",
      email: "student@example.test",
      audience: "admin",
    })
    expect(strong.find((item) => item.id === "length")?.met).toBe(true)
    expect(strong.find((item) => item.id === "notUsername")?.label).toMatch(/the username/)
    expect(strong.find((item) => item.id === "notEmail")?.label).toMatch(/the email/)
    expect(strong.find((item) => item.id === "notUsername")?.met).toBe(true)
    expect(strong.find((item) => item.id === "notEmail")?.met).toBe(true)
  })

  it("keeps every Must row met for generated passwords and never adds a common Must row", () => {
    for (let i = 0; i < 1000; i++) {
      const value = generatePassword()
      const items = evaluatePasswordRequirements(value)
      expect(items.every((item) => item.met)).toBe(true)
      expect(items.some((item) => (item.id as string) === "notCommon")).toBe(false)
      expect(items.some((item) => /common password/i.test(item.label))).toBe(false)
    }
  })
})

describe("portal and Keycloak estimate parity", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const theme = require("../../../deploy/keycloak/themes/cyberrange/login/resources/js/password-strength.js") as {
    estimate: (value: string) => number
    evaluateRequirements: (value: string, context?: { accountName?: string }) => Array<{ id: string; met: boolean }>
  }

  const fixtures = [
    "",
    "short",
    "password123456789",
    "orchid river copper moon",
    "r7#k9z2$m",
    "r7#k9z2$m8%N4",
    "982!sunshine#731",
    "#!@#%^23456789!@#%^2",
    "football1",
    "Welcome to the orchid garden 2026",
  ]

  it("matches estimate scores on shared fixtures", () => {
    for (const value of fixtures) {
      expect(theme.estimate(value)).toBe(estimatePasswordStrength(value))
    }
  })

  it("matches length and identity outcomes with matched context", () => {
    for (const value of fixtures) {
      const portal = evaluatePasswordRequirements(value, { username: "student_demo" })
      const keycloak = theme.evaluateRequirements(value, { accountName: "student_demo" })
      expect(portal.find((item) => item.id === "length")?.met).toBe(
        keycloak.find((item) => item.id === "length")?.met,
      )
      expect(portal.find((item) => item.id === "notUsername")?.met).toBe(
        keycloak.find((item) => item.id === "notAccountName")?.met,
      )
    }
  })
})
