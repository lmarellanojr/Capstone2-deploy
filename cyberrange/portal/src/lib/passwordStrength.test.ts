import {
  estimatePasswordStrength,
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
