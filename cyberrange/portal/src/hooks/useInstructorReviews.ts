'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { instructor, ReviewCase } from '@/lib/api'
import { mapErrorToMessage, isForbiddenError } from '@/lib/errorHandler'

export interface UseInstructorReviewsOptions {
  statusFilter?: string
}

export type ReviewsResultInput =
  | { success: true; reviews: ReviewCase[] }
  | { success: false; error: unknown }

export interface ReviewsState {
  reviews: ReviewCase[]
  error: string | null
  forbidden: boolean
}

/**
 * Pure state evaluator for review query responses, exported for unit testing
 * without rendering the hook (matching evaluateDestroyPollTick pattern).
 */
export function evaluateReviewsResult(input: ReviewsResultInput): ReviewsState {
  if (input.success) {
    return {
      reviews: input.reviews,
      error: null,
      forbidden: false,
    }
  }

  if (isForbiddenError(input.error)) {
    return {
      reviews: [],
      error: null,
      forbidden: true,
    }
  }

  return {
    reviews: [],
    error: mapErrorToMessage(input.error).message,
    forbidden: false,
  }
}

/**
 * Evaluates whether an async response matches the active request sequence counter.
 * Out-of-order responses from stale tab filters return false.
 */
export function isLatestRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId
}

export function useInstructorReviews(options?: UseInstructorReviewsOptions) {
  const [reviews, setReviews] = useState<ReviewCase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const statusFilter = options?.statusFilter
  const requestIdRef = useRef(0)

  const fetchReviews = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current
    setLoading(true)
    try {
      const result = await instructor.listReviews(statusFilter)
      if (!isLatestRequest(currentRequestId, requestIdRef.current)) return
      const evaluated = evaluateReviewsResult({
        success: true,
        reviews: result.reviews || [],
      })
      setReviews(evaluated.reviews)
      setError(evaluated.error)
      setForbidden(evaluated.forbidden)
    } catch (err: unknown) {
      if (!isLatestRequest(currentRequestId, requestIdRef.current)) return
      const evaluated = evaluateReviewsResult({
        success: false,
        error: err,
      })
      setReviews(evaluated.reviews)
      setError(evaluated.error)
      setForbidden(evaluated.forbidden)
    } finally {
      if (isLatestRequest(currentRequestId, requestIdRef.current)) {
        setLoading(false)
      }
    }
  }, [statusFilter])

  useEffect(() => {
    void fetchReviews()
  }, [fetchReviews])

  return { reviews, loading, error, forbidden, refresh: fetchReviews }
}
