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

export type PollTickResult = { status: string } | { error: unknown }
export type PollTickOutcome =
  | { action: 'continue' }
  | { action: 'destroyed' }
  | { action: 'give-up'; message: string }

/**
 * Pure decision for one poll tick, exported for unit testing without
 * rendering the hook. elapsedMs is checked first and unconditionally --
 * Leo's follow-up finding was that a run of persistent transient errors
 * never reached a timeout check that only lived on the success path, so a
 * stuck poll (DESTROYING forever, or 5xx forever) never gave up.
 */
export function evaluateDestroyPollTick(elapsedMs: number, result: PollTickResult): PollTickOutcome {
  if (elapsedMs > STUCK_DESTROY_WARNING_MS) {
    return {
      action: 'give-up',
      message: 'Teardown is taking longer than expected; the backend reaper will retry automatically. Verify manually.',
    }
  }
  if ('status' in result) {
    return result.status === 'DESTROYED' ? { action: 'destroyed' } : { action: 'continue' }
  }
  if (isTransientPollError(result.error)) return { action: 'continue' }
  return {
    action: 'give-up',
    message:
      httpStatus(result.error) === 404
        ? 'Pod not found while confirming teardown — not proof it completed. Verify manually.'
        : 'Could not confirm teardown status. Verify manually.',
  }
}

/**
 * Polls GET /pods/{id}/status after an admin force-destroy until the backend
 * reports DESTROYED. Deliberately does NOT treat a 404 as completion, unlike
 * the student destroy poller (useStatusPoller) -- for Admin, a 404 is
 * ambiguous (unknown pod id vs proxy miss), not proof of teardown (handoff
 * doc §5).
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

      let result: PollTickResult
      let newStatus: string | undefined
      try {
        const pod = await admin.getPod(podId)
        newStatus = pod.status
        result = { status: pod.status }
      } catch (err: unknown) {
        result = { error: err }
      } finally {
        requestInFlight = false
      }

      if (cancelled) return
      if (newStatus !== undefined) setStatus(newStatus)

      const outcome = evaluateDestroyPollTick(Date.now() - startedAt, result)
      if (outcome.action === 'continue') return
      if (outcome.action === 'give-up') setError(outcome.message)
      setIsPolling(false)
      clearInterval(interval)
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [podId])

  return { status, error, isPolling }
}
