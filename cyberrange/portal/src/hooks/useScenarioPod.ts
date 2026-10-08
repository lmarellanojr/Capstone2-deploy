'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { provisioning, Pod } from '@/lib/api'
import axios from 'axios'
import { isConflictError } from '@/lib/errorHandler'
import { destroySession, sessionKey } from '@/components/terminal/terminalSessionManager'

export type PodPhase = 'loading' | 'idle' | 'provisioning' | 'active' | 'failed' | 'expired'

interface UseScenarioPodResult {
  phase: PodPhase
  pod: Pod | null
  error: string | null
  startLab: () => Promise<void>
  endSession: () => Promise<void>
  clearError: () => void
  fetchedAtMs: number
  lastTtlMinutes: number | null
}

function derivePhase(pod: Pod | null, ttlExpiredThisSession: boolean): PodPhase {
  if (!pod) return ttlExpiredThisSession ? 'expired' : 'idle'
  switch (pod.status) {
    case 'PROVISIONING': return 'provisioning'
    case 'ACTIVE': return 'active'
    case 'DESTROYING': return 'expired'
    case 'DESTROYED': return 'expired'
    case 'FAILED_ROLLBACK_COMPLETE': return 'failed'
    default: return 'idle'
  }
}

function closePty(podId: number): void {
  destroySession(sessionKey(podId, 'kali'))
  destroySession(sessionKey(podId, 'meta'))
  destroySession(sessionKey(podId, 'dvwa'))
}

export function useScenarioPod(scenarioId: string, studentId: string): UseScenarioPodResult {
  const [phase, setPhase] = useState<PodPhase>('loading')
  const [pod, setPod] = useState<Pod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now())
  const [lastTtlMinutes, setLastTtlMinutes] = useState<number | null>(null)
  const [, setTtlExpiredThisSession] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ttlExpiredRef = useRef(false)
  const lastPodIdRef = useRef<number | null>(null)
  const ptyClosedForRef = useRef<number | null>(null)
  const userEndedRef = useRef(false)
  const provisioningWaitRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const fetchPod = useCallback(async () => {
    try {
      const result = await provisioning.listPods()
      const match = (result.pods || []).find(
        (p) => p.scenario_id === scenarioId && p.student_id === studentId,
      )

      if (userEndedRef.current) {
        const gone =
          !match ||
          match.status === 'DESTROYED' ||
          match.status === 'FAILED_ROLLBACK_COMPLETE'
        if (gone) userEndedRef.current = false
        ttlExpiredRef.current = false
        setTtlExpiredThisSession(false)
        lastPodIdRef.current = null
        setPod(null)
        setPhase('idle')
        stopPolling()
        if (!gone) {
          intervalRef.current = setInterval(fetchPod, 3_000)
        }
        return
      }

      if (provisioningWaitRef.current) {
        if (match && (match.status === 'PROVISIONING' || match.status === 'ACTIVE')) {
          provisioningWaitRef.current = false
          lastPodIdRef.current = match.pod_id
          setLastTtlMinutes(match.ttl_minutes)
          setFetchedAtMs(Date.now())
          ttlExpiredRef.current = false
          setTtlExpiredThisSession(false)
          setPod(match)
          setPhase(derivePhase(match, false))
          stopPolling()
          const ms = match.status === 'ACTIVE' ? 60_000 : 3_000
          intervalRef.current = setInterval(fetchPod, ms)
        }
        return
      }

      let flag = ttlExpiredRef.current
      if (match) {
        lastPodIdRef.current = match.pod_id
        setLastTtlMinutes(match.ttl_minutes)
        setFetchedAtMs(Date.now())
        if (match.status === 'DESTROYING') flag = true
      } else if (lastPodIdRef.current != null) {
        flag = true
      }

      if (
        flag &&
        lastPodIdRef.current != null &&
        ptyClosedForRef.current !== lastPodIdRef.current
      ) {
        closePty(lastPodIdRef.current)
        ptyClosedForRef.current = lastPodIdRef.current
      }

      ttlExpiredRef.current = flag
      setTtlExpiredThisSession(flag)
      setPod(match ?? null)
      setPhase(derivePhase(match ?? null, flag))

      stopPolling()
      if (match?.status === 'PROVISIONING' || match?.status === 'DESTROYING') {
        intervalRef.current = setInterval(fetchPod, 3_000)
      } else if (match?.status === 'ACTIVE' && match.ttl_expired) {
        intervalRef.current = setInterval(fetchPod, 3_000)
      } else if (match?.status === 'ACTIVE' && match.remaining_seconds <= 15 * 60) {
        intervalRef.current = setInterval(fetchPod, 10_000)
      } else if (match?.status === 'ACTIVE') {
        intervalRef.current = setInterval(fetchPod, 60_000)
      }
    } catch {
      // Keep current phase on transient network errors
    }
  }, [scenarioId, studentId, stopPolling])

  useEffect(() => {
    fetchPod().then(() => {
      setPhase((prev) => (prev === 'loading' ? 'idle' : prev))
    })
    return stopPolling
  }, [fetchPod, stopPolling])

  const startLab = useCallback(async () => {
    userEndedRef.current = false
    provisioningWaitRef.current = true
    ttlExpiredRef.current = false
    setTtlExpiredThisSession(false)
    lastPodIdRef.current = null
    ptyClosedForRef.current = null
    setError(null)
    setPhase('provisioning')
    stopPolling()

    try {
      await provisioning.provision(studentId, scenarioId)
    } catch (err: unknown) {
      provisioningWaitRef.current = false
      if (isConflictError(err)) {
        setError('ALREADY_HAS_POD')
        setPhase('failed')
        return
      }

      let message = 'Failed to provision pod'
      const detail = axios.isAxiosError(err)
        ? String(err.response?.data?.detail ?? err.response?.data?.error ?? '')
        : ''
      if (detail.includes('STORAGE_FULL')) {
        message = 'STORAGE_FULL'
      } else if (detail.includes('RAM_FULL')) {
        message = 'RAM_FULL'
      } else if (detail.includes('POD_CAP_REACHED')) {
        message = 'POD_CAP_REACHED'
      } else if (err instanceof Error) {
        message = err.message
      }
      setError(message)
      setPhase('failed')
      return
    }

    intervalRef.current = setInterval(fetchPod, 3_000)
  }, [scenarioId, studentId, fetchPod, stopPolling])

  const endSession = useCallback(async () => {
    if (!pod) return
    userEndedRef.current = true
    provisioningWaitRef.current = false
    ttlExpiredRef.current = false
    setTtlExpiredThisSession(false)
    if (pod.pod_id) closePty(pod.pod_id)
    ptyClosedForRef.current = pod.pod_id
    lastPodIdRef.current = null
    stopPolling()
    try {
      await provisioning.destroyPod(pod.pod_id)
    } catch {
      // Best-effort; UI transitions regardless
    }
    setPod(null)
    setPhase('idle')
  }, [pod, stopPolling])

  const clearError = useCallback(() => setError(null), [])

  return { phase, pod, error, startLab, endSession, clearError, fetchedAtMs, lastTtlMinutes }
}
