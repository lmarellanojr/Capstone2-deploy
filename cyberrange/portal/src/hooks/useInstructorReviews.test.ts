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

describe("useInstructorReviews race condition mitigation", () => {
  it("determines whether a request matches the latest sequence id", () => {
    const { isLatestRequest } = require("./useInstructorReviews")
    expect(isLatestRequest(1, 1)).toBe(true)
    expect(isLatestRequest(1, 2)).toBe(false)
    expect(isLatestRequest(2, 2)).toBe(true)
    expect(isLatestRequest(2, 3)).toBe(false)
  })

  it("prevents stale out-of-order responses from being applied in deferred simulation", async () => {
    const { isLatestRequest, evaluateReviewsResult } = require("./useInstructorReviews")

    let latestRequestId = 0
    let currentState: { reviews: ReviewCase[]; loading: boolean } = {
      reviews: [],
      loading: false,
    }

    const dispatchRequest = (filter?: string) => {
      const requestId = ++latestRequestId
      currentState.loading = true
      return {
        requestId,
        resolveWith: (data: ReviewCase[]) => {
          if (isLatestRequest(requestId, latestRequestId)) {
            const evaluated = evaluateReviewsResult({ success: true, reviews: data })
            currentState = { reviews: evaluated.reviews, loading: false }
          }
        },
      }
    }

    const allData: ReviewCase[] = [
      {
        review_id: 1,
        student_id: "student1",
        scenario_id: 6,
        milestone_id: 1,
        case_type: "WRITTEN_REPORT",
        report_text: null,
        conflict_reason: null,
        evidence_data: null,
        score: 100,
        status: "APPROVED",
        feedback: null,
        graded_by: null,
        created_at: "2026-09-20T10:00:00Z",
        updated_at: "2026-09-20T10:00:00Z",
      },
    ]

    const pendingData: ReviewCase[] = [
      {
        review_id: 2,
        student_id: "student2",
        scenario_id: 6,
        milestone_id: 1,
        case_type: "WRITTEN_REPORT",
        report_text: null,
        conflict_reason: null,
        evidence_data: null,
        score: null,
        status: "PENDING",
        feedback: null,
        graded_by: null,
        created_at: "2026-09-20T10:00:00Z",
        updated_at: "2026-09-20T10:00:00Z",
      },
    ]

    // Instructor starts on ALL tab -> triggers request 1
    const req1 = dispatchRequest(undefined)
    expect(currentState.loading).toBe(true)

    // Instructor quickly switches to PENDING tab -> triggers request 2
    const req2 = dispatchRequest("PENDING")
    expect(currentState.loading).toBe(true)

    // Request 2 (PENDING) completes first
    req2.resolveWith(pendingData)
    expect(currentState.loading).toBe(false)
    expect(currentState.reviews).toEqual(pendingData)
    expect(currentState.reviews[0].review_id).toBe(2)

    // Request 1 (ALL) arrives out-of-order after request 2
    req1.resolveWith(allData)

    // State MUST remain PENDING data (not overwritten by stale Request 1)
    expect(currentState.loading).toBe(false)
    expect(currentState.reviews).toEqual(pendingData)
    expect(currentState.reviews[0].review_id).toBe(2)
  })

  it("ensures error state is distinguishable from empty state to prevent dual rendering", () => {
    const { evaluateReviewsResult } = require("./useInstructorReviews")
    const errorState = evaluateReviewsResult({
      success: false,
      error: { isAxiosError: true, response: { status: 500, data: { detail: "Internal Error" } } },
    })

    expect(errorState.error).toBeTruthy()
    expect(errorState.reviews).toEqual([])

    // Guard logic: only render empty-state when error is null
    const getRenderBranch = (error: string | null, reviewsCount: number) => {
      if (error) return "error-only"
      if (reviewsCount === 0) return "empty-state"
      return "table"
    }

    expect(getRenderBranch(errorState.error, errorState.reviews.length)).toBe("error-only")
    expect(getRenderBranch(null, 0)).toBe("empty-state")
    expect(getRenderBranch(null, 5)).toBe("table")
  })
})


