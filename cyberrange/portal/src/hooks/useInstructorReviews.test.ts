import { evaluateReviewsResult, ReviewsResultInput } from "./useInstructorReviews"
import { ReviewCase } from "@/lib/api"

const mockReviews: ReviewCase[] = [
  {
    review_id: 101,
    student_id: "student_alpha",
    scenario_id: 6,
    milestone_id: 1,
    case_type: "WRITTEN_REPORT",
    report_text: "Completed SSH analysis",
    conflict_reason: null,
    evidence_data: '{"port": 22}',
    score: null,
    status: "PENDING",
    feedback: null,
    graded_by: null,
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
  },
]

describe("evaluateReviewsResult", () => {
  it("evaluates successful response correctly", () => {
    const input: ReviewsResultInput = {
      success: true,
      reviews: mockReviews,
    }
    const state = evaluateReviewsResult(input)

    expect(state).toEqual({
      reviews: mockReviews,
      error: null,
      forbidden: false,
    })
  })

  it("evaluates empty successful response correctly", () => {
    const input: ReviewsResultInput = {
      success: true,
      reviews: [],
    }
    const state = evaluateReviewsResult(input)

    expect(state).toEqual({
      reviews: [],
      error: null,
      forbidden: false,
    })
  })

  it("sets forbidden to true and error to null when API returns 403", () => {
    const error403 = {
      isAxiosError: true,
      response: {
        status: 403,
        data: { detail: "Forbidden: Insufficient privileges" },
      },
    }
    const input: ReviewsResultInput = {
      success: false,
      error: error403,
    }
    const state = evaluateReviewsResult(input)

    expect(state).toEqual({
      reviews: [],
      error: null,
      forbidden: true,
    })
  })

  it("maps 500 error into a user-readable error message and forbidden to false", () => {
    const error500 = {
      isAxiosError: true,
      response: {
        status: 500,
        data: { detail: "Internal Server Error" },
      },
    }
    const input: ReviewsResultInput = {
      success: false,
      error: error500,
    }
    const state = evaluateReviewsResult(input)

    expect(state.reviews).toEqual([])
    expect(state.forbidden).toBe(false)
    expect(state.error).toBeTruthy()
    expect(typeof state.error).toBe("string")
  })

  it("maps network errors into a user-readable error message", () => {
    const networkError = new Error("Network Error")
    const input: ReviewsResultInput = {
      success: false,
      error: networkError,
    }
    const state = evaluateReviewsResult(input)

    expect(state.reviews).toEqual([])
    expect(state.forbidden).toBe(false)
    expect(state.error).toMatch(/network/i)
  })
})
