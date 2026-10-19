/** Advisory estimate only; Keycloak enforces acceptance on save. */
export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4

const LABELS = ["", "Weak", "Medium", "Good", "Strong"] as const

export function estimatePasswordStrength(value: string): PasswordStrengthScore {
  if (!value) return 0
  const nfkc = value.normalize("NFKC").toLowerCase()
  const normalized = nfkc
    .replace(/[0@]/g, "a")
    .replace(/[1!]/g, "i")
    .replace(/3/g, "e")
    .replace(/\$/g, "s")
  if (
    value.length < 8 ||
    /(.+)\1{2,}/u.test(normalized) ||
    /password|passw|qwerty|letmein|welcome|cyberrange|capstone|123456|abcdef|abcdefghijkl/i.test(normalized) ||
    new Set(normalized).size < 5
  ) {
    return 1
  }
  const score = (value.length < 12 ? 2 : value.length < 16 ? 3 : 4) as PasswordStrengthScore
  if (/^[a-z\s]+$/.test(nfkc)) return Math.min(score, 2) as PasswordStrengthScore
  return score
}

export function passwordStrengthLabel(score: PasswordStrengthScore): string {
  return score ? `Password strength: ${LABELS[score]}` : "Enter a new password to see its strength."
}

/** Fill width for the continuous indicator bar. */
export function passwordStrengthWidth(score: PasswordStrengthScore): string {
  return ["0%", "33%", "55%", "78%", "100%"][score]
}

export function passwordStrengthColor(score: PasswordStrengthScore): string {
  return ["transparent", "#ef4444", "#eab308", "#84cc16", "#22c55e"][score]
}

export function passwordStrengthTextColor(score: PasswordStrengthScore): string {
  return ["inherit", "#ef4444", "#ca8a04", "#65a30d", "#16a34a"][score]
}
