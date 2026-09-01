'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { provisioning, Pod } from '@/lib/api'
import { mapErrorToMessage } from '@/lib/errorHandler'

/** Pod statuses shown on the student dashboard list. */
export const VISIBLE_POD_STATUSES = ['PROVISIONING', 'ACTIVE', 'DESTROYING'] as const

/** Student-facing concurrent pod cap (API MAX_PODS=1 on this host). */
export const MAX_STUDENT_PODS = 1

export type VisiblePodStatus = (typeof VISIBLE_POD_STATUSES)[number]

function isVisibleStatus(status: string): status is VisiblePodStatus {
  return (VISIBLE_POD_STATUSES as readonly string[]).includes(status)
}

export function filterVisiblePods(pods: Pod[]): Pod[] {
  return pods.filter((p) => isVisibleStatus(p.status))
}

export function usePods(pollInterval = 5000) {
  const [pods, setPods] = useState<Pod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Track last toasted error so interval polls do not spam toasts.
  const lastToastedError = useRef<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const fetchPods = useCallback(async (options?: { notify?: boolean }) => {
    const notify = options?.notify ?? false
    try {
      const result = await provisioning.listPods()
      const visible = filterVisiblePods(result.pods || [])
      setPods(visible)
      setError(null)
      lastToastedError.current = null
      setToastMessage(null)
    } catch (err: unknown) {
      const { message } = mapErrorToMessage(err)
      setError(message)
      setPods([])
      if (notify && message !== lastToastedError.current) {
        lastToastedError.current = message
        setToastMessage(message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial load: surface fetch failures via toast.
    void fetchPods({ notify: true })

    // Background poll: update list silently (no toast spam).
    const interval = setInterval(() => {
      void fetchPods({ notify: false })
    }, pollInterval)

    return () => clearInterval(interval)
  }, [fetchPods, pollInterval])

  /**
   * Re-fetch the pod list.
   * - silent: skip the full-list loading spinner (create/destroy follow-ups)
   * - notify: surface fetch failures via toast (default true for action-driven refresh;
   *   background poll uses fetchPods({ notify: false }) directly)
   */
  const refreshPods = useCallback(
    async (options?: { silent?: boolean; notify?: boolean }) => {
      const silent = options?.silent ?? false
      // Action-driven refresh always toasts on failure unless explicitly opted out.
      const notify = options?.notify ?? true
      if (!silent) {
        setLoading(true)
      }
      await fetchPods({ notify })
    },
    [fetchPods]
  )

  const clearToastMessage = useCallback(() => {
    setToastMessage(null)
  }, [])

  return { pods, loading, error, refreshPods, toastMessage, clearToastMessage }
}
