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
  it("tracks length, identity, common-password, and save-time history rules", () => {
    const empty = evaluatePasswordRequirements("", { username: "student_demo", email: "student@example.test" })
    expect(empty.find((item) => item.id === "length")?.met).toBe(false)
    expect(empty.find((item) => item.id === "notUsername")?.met).toBe(false)
    expect(empty.find((item) => item.id === "notEmail")?.met).toBe(false)
    expect(empty.find((item) => item.id === "notCommon")?.met).toBe(false)
    expect(empty.some((item) => item.id === "history")).toBe(false)

    const weak = evaluatePasswordRequirements("short", { username: "student_demo" })
    expect(weak.find((item) => item.id === "length")?.met).toBe(false)

    const common = evaluatePasswordRequirements("password123", { username: "student_demo" })
    expect(common.find((item) => item.id === "length")?.met).toBe(true)
    expect(common.find((item) => item.id === "notCommon")?.met).toBe(false)

    const sameUser = evaluatePasswordRequirements("student_demo", { username: "student_demo" })
    expect(sameUser.find((item) => item.id === "notUsername")?.met).toBe(false)

    const strong = evaluatePasswordRequirements("#!@#%^23456789!@#%^2", {
      username: "student_demo",
      email: "student@example.test",
    })
    expect(strong.find((item) => item.id === "length")?.met).toBe(true)
    expect(strong.find((item) => item.id === "notUsername")?.met).toBe(true)
    expect(strong.find((item) => item.id === "notEmail")?.met).toBe(true)
    expect(strong.find((item) => item.id === "notCommon")?.met).toBe(true)
  })
})
