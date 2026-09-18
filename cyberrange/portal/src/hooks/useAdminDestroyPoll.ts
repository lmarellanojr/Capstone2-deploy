'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { admin } from '@/lib/api'

const POLL_INTERVAL_MS = 2500

function httpStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined
}

function isTransientPollError(err: unknown): boolean {
  const status = httpStatus(err)
  if (status !== undefined && status >= 500 && status < 600) return true
  return axios.isAxiosError(err) && err.response == null
}

/**
 * Polls GET /pods/{id}/status after an admin force-destroy until the backend
 * reports DESTROYED. Deliberately does NOT treat a 404 as completion, unlike
 * the student destroy poller (useStatusPoller) -- for Admin, a 404 is
 * ambiguous (unknown pod id vs proxy miss), not proof of teardown (handoff
 * doc §5). On 404 or any other non-transient error, polling stops and the
 * caller is told to verify manually instead of assuming success.
 *
 * Pass null to leave idle; pass a podId to start polling it.
 */
export function useAdminDestroyPoll(podId: number | null) {
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  useEffect(() => {
    if (podId === null) {
      setStatus(null)
      setError(null)
      setIsPolling(false)
      return
    }

    setStatus(null)
    setError(null)
    setIsPolling(true)

    const interval = setInterval(async () => {
      try {
        const pod = await admin.getPod(podId)
        setStatus(pod.status)
        if (pod.status === 'DESTROYED') {
          setIsPolling(false)
          clearInterval(interval)
        }
      } catch (err: unknown) {
        if (isTransientPollError(err)) return
        setError(
          httpStatus(err) === 404
            ? 'Pod not found while confirming teardown — not proof it completed. Verify manually.'
            : 'Could not confirm teardown status. Verify manually.'
        )
        setIsPolling(false)
        clearInterval(interval)
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [podId])

  return { status, error, isPolling }
}
