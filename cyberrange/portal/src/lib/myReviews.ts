// Which verification requests this student has sent, remembered per browser.
//
// Why local: the backend has no "list my own review cases" endpoint yet
// (only POST /reviews/submit, GET /reviews/{id}, POST .../resubmit). Until one
// exists, the portal keeps the ids it created and re-reads each case from the
// backend, which stays the source of truth for status and feedback. A request
// made on another device won't appear here — see the handoff notes.
//
// Keyed by student so a shared lab computer never shows one student another
// student's requests. Storage can be blocked; every accessor degrades quietly.

export interface TrackedReview {
  reviewId: number
  scenarioId: string // catalog id, e.g. "06"
  milestoneId: number | null
  createdAt: string // ISO, when this browser submitted it
}

const key = (studentId: string) => `cr.myReviews.${studentId}`

function isTracked(v: unknown): v is TrackedReview {
  if (!v || typeof v !== "object") return false
  const r = v as Record<string, unknown>
  return (
    Number.isInteger(r.reviewId) &&
    typeof r.scenarioId === "string" &&
    (r.milestoneId === null || Number.isInteger(r.milestoneId)) &&
    typeof r.createdAt === "string"
  )
}

export function readTrackedReviews(studentId: string): TrackedReview[] {
  if (!studentId) return []
  try {
    const raw = window.localStorage.getItem(key(studentId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isTracked) : []
  } catch {
    return []
  }
}

function write(studentId: string, list: TrackedReview[]): void {
  try {
    window.localStorage.setItem(key(studentId), JSON.stringify(list))
  } catch {
    // Storage unavailable: the request still exists server-side.
  }
}

export function trackReview(studentId: string, review: TrackedReview): TrackedReview[] {
  if (!studentId) return []
  const next = [review, ...readTrackedReviews(studentId).filter((r) => r.reviewId !== review.reviewId)]
  write(studentId, next)
  return next
}

/** Drops ids the backend no longer returns (404: deleted, or not ours). */
export function forgetReviews(studentId: string, reviewIds: number[]): TrackedReview[] {
  if (!studentId) return []
  const drop = new Set(reviewIds)
  const next = readTrackedReviews(studentId).filter((r) => !drop.has(r.reviewId))
  write(studentId, next)
  return next
}
