import type { StudentReviewCase } from "@/lib/api"

// Student-facing words for review_cases.status. The instructor tools keep the
// raw values; a student needs to know what happens next, not the enum.
export const REVIEW_STATUS: Record<
  StudentReviewCase["status"],
  { label: string; variant: "warning" | "success" | "danger" | "info"; hint: string }
> = {
  PENDING: {
    label: "Waiting for instructor",
    variant: "warning",
    hint: "Your instructor hasn't reviewed this yet.",
  },
  APPROVED: {
    label: "Approved",
    variant: "success",
    hint: "Your instructor confirmed this task.",
  },
  REJECTED: {
    label: "Not approved",
    variant: "danger",
    hint: "Your instructor couldn't confirm this task. Read their feedback, then try the task again.",
  },
  RETRY: {
    label: "More detail needed",
    variant: "info",
    hint: "Your instructor asked you to add detail and send it again.",
  },
}

export const REQUEST_MIN_CHARS = 20
export const REQUEST_MAX_CHARS = 10_000
