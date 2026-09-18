'use client'

import { useState, useEffect } from 'react'
import { admin } from '@/lib/api'
import { httpStatus, isTransientPollError } from '@/hooks/useStatusPoller'

const POLL_INTERVAL_MS = 2500
// perform_destruction (provision.py) leaves a pod in DESTROYING on a partial
// LXD failure rather than marking it DESTROYED; reaper.py only retries it
// after STUCK_POD_GRACE_MINUTES (30 min default). Polling forever would hang
// the row's UI state, so this is a client-side give-up threshold, not a
// claim about when the backend actually retries.
const STUCK_DESTROY_WARNING_MS = 5 * 60 * 1000

/**
 * Polls GET /pods/{id}/status after an admin force-destroy until the backend
 * reports DESTROYED. Deliberately does NOT treat a 404 as completion, unlike
 * the student destroy poller (useStatusPoller) -- for Admin, a 404 is
 * ambiguous (unknown pod id vs proxy miss), not proof of teardown (handoff
 * doc §5). On 404, a stuck-DESTROYING timeout, or any other non-transient
 * error, polling stops and the caller is told to verify manually instead of
 * assuming success.
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

    let cancelled = false
    let requestInFlight = false
    const startedAt = Date.now()

    const interval = setInterval(async () => {
      if (requestInFlight) return // don't overlap a slow response with the next tick
      requestInFlight = true
      try {
        const pod = await admin.getPod(podId)
        if (cancelled) return
        setStatus(pod.status)
        if (pod.status === 'DESTROYED') {
          setIsPolling(false)
          clearInterval(interval)
          return
        }
        if (Date.now() - startedAt > STUCK_DESTROY_WARNING_MS) {
          setError(
            'Teardown is taking longer than expected; the backend reaper will retry automatically. Verify manually.'
          )
          setIsPolling(false)
          clearInterval(interval)
        }
      } catch (err: unknown) {
        if (cancelled) return
        if (isTransientPollError(err)) return
        setError(
          httpStatus(err) === 404
            ? 'Pod not found while confirming teardown — not proof it completed. Verify manually.'
            : 'Could not confirm teardown status. Verify manually.'
        )
        setIsPolling(false)
        clearInterval(interval)
      } finally {
        requestInFlight = false
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [podId])

  return { status, error, isPolling }
}
