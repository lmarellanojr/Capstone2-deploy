'use client'

import { useState, useEffect, useCallback } from 'react'
import { admin, Pod, Capacity } from '@/lib/api'
import { mapErrorToMessage } from '@/lib/errorHandler'

// GET /pods only self-scopes non-admins (no 403) -- AUTH-04 middleware/AuthGate
// already gate /admin/* by role, so a real 403 here isn't part of the contract
// (handoff doc §2/§6). No forbidden state; a generic error covers 401/5xx.
export function useAdminPods() {
  const [pods, setPods] = useState<Pod[]>([])
  const [capacity, setCapacity] = useState<Capacity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [podsResult, capacityResult] = await Promise.all([admin.listPods(), admin.getCapacity()])
      setPods(podsResult.pods || [])
      setCapacity(capacityResult)
      setError(null)
    } catch (err: unknown) {
      setPods([])
      setCapacity(null)
      setError(mapErrorToMessage(err).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  return { pods, capacity, loading, error, refresh: fetchAll }
}
