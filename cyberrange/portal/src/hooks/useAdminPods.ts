'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { admin, Pod, Capacity } from '@/lib/api'
import { mapErrorToMessage } from '@/lib/errorHandler'

// GET /pods only self-scopes non-admins (no 403) -- AUTH-04 middleware/AuthGate
// already gate /admin/* by role, so a real 403 here isn't part of the contract
// (handoff doc §2/§6). No forbidden state; a generic error covers 401/5xx.
export function useAdminPods() {
  const [pods, setPods] = useState<Pod[]>([])
  const [capacity, setCapacity] = useState<Capacity | null>(null)
  // Only true until the first fetch settles -- a post-destroy refresh() must
  // not blank the table back to a full-page spinner (review finding).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [capacityError, setCapacityError] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const fetchAll = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true)
    // Capacity is informational (the "N / M active pods" header) -- its
    // failure must not blank out an otherwise-successful pod list.
    const [podsResult, capacityResult] = await Promise.allSettled([admin.listPods(), admin.getCapacity()])

    if (podsResult.status === 'fulfilled') {
      setPods(podsResult.value.pods || [])
      setError(null)
    } else {
      setPods([])
      setError(mapErrorToMessage(podsResult.reason).message)
    }

    if (capacityResult.status === 'fulfilled') {
      setCapacity(capacityResult.value)
      setCapacityError(null)
    } else {
      setCapacity(null)
      setCapacityError(mapErrorToMessage(capacityResult.reason).message)
    }

    hasLoadedOnce.current = true
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  return { pods, capacity, loading, error, capacityError, refresh: fetchAll }
}
