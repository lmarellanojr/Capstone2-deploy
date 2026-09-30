'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { reviews, StudentReviewCase } from '@/lib/api'
import { backendDetail, isNotFoundError } from '@/lib/errorHandler'
import { forgetReviews, readTrackedReviews, trackReview, type TrackedReview } from '@/lib/myReviews'

export interface MyReview {
  tracked: TrackedReview
  /** null until loaded, or when the backend couldn't be reached. */
  case: StudentReviewCase | null
}

/** The student's own verification requests (see lib/myReviews.ts for why
 *  the id list is per-browser). Status and feedback always come from the backend. */
export function useMyReviews() {
  const { data: session } = useSession()
  const studentId = session?.user?.name ?? ''
  const [items, setItems] = useState<MyReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!studentId) {
      setItems([])
      setLoading(false)
      return
    }
    const tracked = readTrackedReviews(studentId)
    if (tracked.length === 0) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    const results = await Promise.allSettled(tracked.map((t) => reviews.get(t.reviewId)))
    const gone: number[] = []
    let failure: string | null = null
    const next: MyReview[] = []
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        next.push({ tracked: tracked[i], case: res.value })
      } else if (isNotFoundError(res.reason)) {
        gone.push(tracked[i].reviewId)
      } else {
        failure = backendDetail(res.reason)
        next.push({ tracked: tracked[i], case: null })
      }
    })
    if (gone.length) forgetReviews(studentId, gone)
    setItems(next)
    setError(failure)
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load])

  /** Throws a user-safe message on failure. */
  const submit = useCallback(
    async (data: {
      scenarioId: string
      milestoneId: number | null
      conflictReason: string
      reportText?: string
    }) => {
      try {
        const res = await reviews.submit({
          scenario_id: Number(data.scenarioId),
          milestone_id: data.milestoneId,
          case_type: 'MANUAL_REVIEW',
          conflict_reason: data.conflictReason.trim(),
          report_text: data.reportText?.trim() || null,
        })
        trackReview(studentId, {
          reviewId: res.review_id,
          scenarioId: data.scenarioId,
          milestoneId: data.milestoneId,
          createdAt: new Date().toISOString(),
        })
        void load()
        return res.review_id
      } catch (err) {
        throw new Error(backendDetail(err))
      }
    },
    [studentId, load]
  )

  /** Throws a user-safe message on failure. */
  const resubmit = useCallback(
    async (reviewId: number, data: { conflictReason?: string; reportText?: string }) => {
      try {
        await reviews.resubmit(reviewId, {
          conflict_reason: data.conflictReason?.trim() || null,
          report_text: data.reportText?.trim() || null,
        })
        void load()
      } catch (err) {
        throw new Error(backendDetail(err))
      }
    },
    [load]
  )

  return { items, loading, error, studentId, refresh: load, submit, resubmit }
}
