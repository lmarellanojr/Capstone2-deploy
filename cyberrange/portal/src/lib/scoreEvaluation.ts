export type ReviewDecision = "APPROVED" | "REJECTED" | "RETRY"

export interface ScoreValidationResult {
  valid: boolean
  error?: string
}

export interface ScorePayloadResult {
  score: number | null
  display: string
}

/**
 * Validates a score input before opening the confirmation modal.
 * - APPROVED requires a non-empty integer between 0 and 100.
 * - REJECTED and RETRY do not require a score.
 */
export function validateScore(
  decision: ReviewDecision,
  scoreInput: number | string
): ScoreValidationResult {
  if (decision === "APPROVED") {
    if (scoreInput === "" || scoreInput === null || scoreInput === undefined) {
      return {
        valid: false,
        error: "Please provide a valid score between 0 and 100 for approval.",
      }
    }
    const num = Number(scoreInput)
    if (isNaN(num) || !Number.isInteger(num) || num < 0 || num > 100) {
      return {
        valid: false,
        error: "Score must be a whole integer between 0 and 100.",
      }
    }
  }
  return { valid: true }
}

/**
 * Derives the exact numeric score payload and confirmation modal display string.
 * This guarantees 1:1 parity between what the instructor confirms in the UI
 * and what is dispatched to the backend.
 *
 * - APPROVED: Sends the validated integer score (0..100).
 * - REJECTED: Sends 0 (backend default), preventing stale or typed scores from persisting.
 * - RETRY: Sends null, clearing any prior score in the database.
 */
export function resolveScorePayload(
  decision: ReviewDecision,
  scoreInput: number | string
): ScorePayloadResult {
  if (decision === "APPROVED") {
    const num = Number(scoreInput)
    return {
      score: num,
      display: `${num} / 100`,
    }
  }

  if (decision === "REJECTED") {
    return {
      score: 0,
      display: "0 / 100 (rejected)",
    }
  }

  // RETRY
  return {
    score: null,
    display: "None (retry requested)",
  }
}
