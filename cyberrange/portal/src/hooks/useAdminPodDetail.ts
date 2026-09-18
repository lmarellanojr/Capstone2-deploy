'use client'

import { useState, useEffect, useCallback } from 'react'
import { admin, Pod } from '@/lib/api'
import { mapErrorToMessage, isNotFoundError } from '@/lib/errorHandler'

export function useAdminPodDetail(podId: number) {
  const [pod, setPod] = useState<Pod | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now())

  const fetchPod = useCallback(async () => {
    setLoading(true)
    try {
      const result = await admin.getPod(podId)
      setPod(result)
      setFetchedAtMs(Date.now())
      setError(null)
      setNotFound(false)
    } catch (err: unknown) {
      setPod(null)
      if (isNotFoundError(err)) {
        setNotFound(true)
        setError(null)
      } else {
        setNotFound(false)
        setError(mapErrorToMessage(err).message)
      }
    } finally {
      setLoading(false)
    }
  }, [podId])

  useEffect(() => {
    void fetchPod()
  }, [fetchPod])

  return { pod, loading, error, notFound, fetchedAtMs, refresh: fetchPod }
}
