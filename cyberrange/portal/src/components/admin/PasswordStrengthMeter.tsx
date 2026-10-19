"use client"

import {
  estimatePasswordStrength,
  passwordStrengthColor,
  passwordStrengthLabel,
  passwordStrengthTextColor,
  passwordStrengthWidth,
} from "@/lib/passwordStrength"

interface PasswordStrengthMeterProps {
  password: string
  /** Optional id for aria-describedby on the password input. */
  labelId?: string
}

/** Live continuous bar (weak → strong). Advisory only; server enforces policy. */
export function PasswordStrengthMeter({ password, labelId = "cr-admin-password-strength" }: PasswordStrengthMeterProps) {
  const score = estimatePasswordStrength(password)
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
    </div>
  )
}
