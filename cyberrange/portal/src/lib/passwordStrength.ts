/** Advisory estimate only; Keycloak enforces acceptance on save. */
export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4

const LABELS = ["", "Weak", "Medium", "Good", "Strong"] as const
const COMMON_PATTERN =
  /password|passw|qwerty|letmein|welcome|cyberrange|capstone|123456|abcdef|abcdefghijkl/i

/** Live Must rows only — never include heuristic/blocklist as Must ✓/✗. */
export type PasswordRequirementId = "length" | "notUsername" | "notEmail"

export type PasswordMeterAudience = "self" | "admin"

export interface PasswordRequirement {
  id: PasswordRequirementId
  /** Short “must …” line shown under the meter. */
  label: string
  /** true = met, false = not met. */
  met: boolean
}

/** Always-on muted note: realm passwordBlacklist is checked on save. */
export const PASSWORD_COMMON_SAVE_HINT = "Common passwords are checked when you save."

/** Self-service history note (Keycloak UPDATE_PASSWORD / own account). */
export const PASSWORD_HISTORY_HINT_SELF = "Your last 3 passwords are also checked when you save."

/** Admin reset history note. */
export const PASSWORD_HISTORY_HINT_ADMIN = "The user's last 3 passwords are also checked when you save."

export interface PasswordRequirementContext {
  username?: string | null
  email?: string | null
  audience?: PasswordMeterAudience
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

/** Live checklist aligned to client-checkable realm rules (no composition / no blocklist Must). */
export function evaluatePasswordRequirements(
  value: string,
  context: PasswordRequirementContext = {},
): PasswordRequirement[] {
  const username = context.username?.trim() || ""
  const email = context.email?.trim() || ""
  const audience = context.audience ?? "self"
  const yourOrThe = audience === "admin" ? "the" : "your"
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
      label: `Must not match ${yourOrThe} username`,
      met: Boolean(value) && normalizedValue !== normalizeIdentity(username),
    })
  }
  if (email) {
    items.push({
      id: "notEmail",
      label: `Must not match ${yourOrThe} email`,
      met: Boolean(value) && normalizedValue !== normalizeIdentity(email),
    })
  }
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
