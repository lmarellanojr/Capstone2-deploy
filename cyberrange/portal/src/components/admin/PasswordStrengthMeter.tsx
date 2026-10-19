"use client"

import {
  estimatePasswordStrength,
  evaluatePasswordRequirements,
  passwordStrengthColor,
  passwordStrengthLabel,
  passwordStrengthTextColor,
  passwordStrengthWidth,
  type PasswordRequirementContext,
} from "@/lib/passwordStrength"

interface PasswordStrengthMeterProps {
  password: string
  /** Optional id for aria-describedby on the password input. */
  labelId?: string
  /** Identity fields used for live “must not match” checks. */
  context?: PasswordRequirementContext
}

/** Live continuous bar + must-meet checklist. Advisory; server enforces policy. */
export function PasswordStrengthMeter({
  password,
  labelId = "cr-admin-password-strength",
  context,
}: PasswordStrengthMeterProps) {
  const score = estimatePasswordStrength(password)
  const requirements = evaluatePasswordRequirements(password, context)
  const listId = `${labelId}-must`
  return (
    <div className="mt-2" data-score={score} data-testid="password-strength-meter">
      <div className="h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
        <div
          className="h-full rounded-full transition-[width,background-color] duration-200 ease-out"
          style={{ width: passwordStrengthWidth(score), backgroundColor: passwordStrengthColor(score) }}
        />
      </div>
      <p
        id={labelId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-1.5 text-xs font-semibold"
        style={{ color: score ? passwordStrengthTextColor(score) : undefined }}
      >
        <span className={score ? undefined : "text-text-muted font-normal"}>{passwordStrengthLabel(score)}</span>
      </p>
      <ul id={listId} className="mt-2 space-y-1" aria-label="Password requirements">
        {requirements.map((item) => {
          const tone =
            item.met === true
              ? "text-green-700"
              : item.met === false
                ? password
                  ? "text-red-600"
                  : "text-text-muted"
                : "text-text-muted"
          const mark = item.met === true ? "✓" : item.met === false ? "○" : "•"
          return (
            <li key={item.id} className={`flex gap-2 text-xs ${tone}`} data-met={item.met === null ? "pending" : String(item.met)}>
              <span aria-hidden="true" className="w-3 shrink-0 font-semibold">
                {mark}
              </span>
              <span>
                {item.label}
                {item.met === true ? <span className="sr-only"> (met)</span> : null}
                {item.met === false && password ? <span className="sr-only"> (not met)</span> : null}
                {item.met === null ? <span className="sr-only"> (checked when you save)</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
