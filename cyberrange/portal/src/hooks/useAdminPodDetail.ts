'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { admin, Pod } from '@/lib/api'
import { mapErrorToMessage, isNotFoundError } from '@/lib/errorHandler'

export function useAdminPodDetail(podId: number) {
  const [pod, setPod] = useState<Pod | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now())
  const hasLoadedOnce = useRef(false)

  const fetchPod = useCallback(async () => {
    // /admin/pods/abc -> Number("abc") is NaN; a request would 404 upstream
    // via /pods/NaN/status but isNotFoundError only matches an actual 404
    // response, so this would otherwise show a generic error banner instead
    // of "Pod not found" (review finding). Hooks can't be called
    // conditionally, so the guard lives inside the fetch instead of skipping
    // the hook.
    if (!Number.isInteger(podId)) {
      setPod(null)
      setNotFound(true)
      setError(null)
      setLoading(false)
      hasLoadedOnce.current = true
      return
    }

    if (!hasLoadedOnce.current) setLoading(true)
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
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }, [podId])

  useEffect(() => {
    void fetchPod()
  }, [fetchPod])

  return { pod, loading, error, notFound, fetchedAtMs, refresh: fetchPod }
}
