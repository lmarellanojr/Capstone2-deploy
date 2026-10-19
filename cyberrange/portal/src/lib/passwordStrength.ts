/** Advisory estimate only; Keycloak enforces acceptance on save. */
export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4

const LABELS = ["", "Weak", "Medium", "Good", "Strong"] as const
const COMMON_PATTERN =
  /password|passw|qwerty|letmein|welcome|cyberrange|capstone|123456|abcdef|abcdefghijkl/i

export type PasswordRequirementId = "length" | "notUsername" | "notEmail" | "notCommon" | "history"

export interface PasswordRequirement {
  id: PasswordRequirementId
  /** Short “must …” line shown under the meter. */
  label: string
  /** true = met, false = not met, null = only checked on save. */
  met: boolean | null
}

export interface PasswordRequirementContext {
  username?: string | null
  email?: string | null
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim()
}

function looksCommon(value: string): boolean {
  const nfkc = value.normalize("NFKC").toLowerCase()
  const normalized = nfkc
    .replace(/[0@]/g, "a")
    .replace(/[1!]/g, "i")
    .replace(/3/g, "e")
    .replace(/\$/g, "s")
  return (
    /(.+)\1{2,}/u.test(normalized) ||
    COMMON_PATTERN.test(normalized) ||
    new Set(normalized).size < 5
  )
}

export function estimatePasswordStrength(value: string): PasswordStrengthScore {
  if (!value) return 0
  const nfkc = value.normalize("NFKC").toLowerCase()
  if (value.length < 8 || looksCommon(value)) return 1
  const score = (value.length < 12 ? 2 : value.length < 16 ? 3 : 4) as PasswordStrengthScore
  if (/^[a-z\s]+$/.test(nfkc)) return Math.min(score, 2) as PasswordStrengthScore
  return score
}

/** Live checklist aligned to the realm policy (no composition rules). */
export function evaluatePasswordRequirements(
  value: string,
  context: PasswordRequirementContext = {},
): PasswordRequirement[] {
  const username = context.username?.trim() || ""
  const email = context.email?.trim() || ""
  const normalizedValue = value ? normalizeIdentity(value) : ""
  const items: PasswordRequirement[] = [
    {
      id: "length",
      label: "Must be 8–128 characters",
      met: value.length >= 8 && value.length <= 128,
    },
  ]
  if (username) {
    items.push({
      id: "notUsername",
      label: "Must not match your username",
      met: Boolean(value) && normalizedValue !== normalizeIdentity(username),
    })
  }
  if (email) {
    items.push({
      id: "notEmail",
      label: "Must not match your email",
      met: Boolean(value) && normalizedValue !== normalizeIdentity(email),
    })
  }
  items.push({
    id: "notCommon",
    label: "Must not be a common password",
    met: value.length > 0 && !looksCommon(value),
  })
  items.push({
    id: "history",
    label: "Must not reuse your last 3 passwords (checked when you save)",
    met: null,
  })
  return items
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
