'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { instructor, InstructorPodWithProgress } from '@/lib/api'
import { backendDetail, isForbiddenError } from '@/lib/errorHandler'

// Live-lab monitor refresh cadence. Milestones land every few seconds while a
// student works, but an instructor overview doesn't need the student view's 3s.
const REFRESH_MS = 30_000

export function useInstructorPods() {
  const [pods, setPods] = useState<InstructorPodWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now())
  const hasLoadedOnce = useRef(false)

  const fetchPods = useCallback(async () => {
    // Background refreshes keep the table on screen instead of a spinner.
    if (!hasLoadedOnce.current) setLoading(true)
    try {
      const result = await instructor.listPods()
      setPods(result.pods || [])
      setFetchedAtMs(Date.now())
      setError(null)
      setForbidden(false)
    } catch (err) {
      if (isForbiddenError(err)) {
        setForbidden(true)
        setError(null)
      } else {
        setError(backendDetail(err))
      }
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPods()
    const id = setInterval(() => void fetchPods(), REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchPods])

  return { pods, loading, error, forbidden, fetchedAtMs, refresh: fetchPods }
}
