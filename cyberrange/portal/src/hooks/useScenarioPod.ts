'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { provisioning, Pod } from '@/lib/api'
import axios from 'axios'
import { isConflictError } from '@/lib/errorHandler'

export type PodPhase = 'loading' | 'idle' | 'provisioning' | 'active' | 'failed' | 'expired'

interface UseScenarioPodResult {
  phase: PodPhase
  pod: Pod | null
  error: string | null
  startLab: () => Promise<void>
  endSession: () => Promise<void>
  clearError: () => void
}

function derivePhase(pod: Pod | null): PodPhase {
  if (!pod) return 'idle'
  switch (pod.status) {
    case 'PROVISIONING': return 'provisioning'
    case 'ACTIVE': return 'active'
    case 'DESTROYED': return 'expired'
    case 'FAILED_ROLLBACK_COMPLETE': return 'failed'
    default: return 'idle'
  }
}

export function useScenarioPod(scenarioId: string, studentId: string): UseScenarioPodResult {
  const [phase, setPhase] = useState<PodPhase>('loading')
  const [pod, setPod] = useState<Pod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
        (p) => p.scenario_id === scenarioId && p.student_id === studentId
      )
      const newPhase = derivePhase(match ?? null)
      setPod(match ?? null)
      setPhase(newPhase)

      // Adjust poll interval based on new phase
      if (newPhase === 'active' || newPhase === 'idle' || newPhase === 'failed' || newPhase === 'expired') {
        stopPolling()
        if (newPhase === 'active') {
          // Heartbeat poll — slow
          intervalRef.current = setInterval(fetchPod, 60_000)
        }
      }
    } catch {
      // Keep current phase on transient network errors
    }
  }, [scenarioId, studentId, stopPolling])

  // Initial load
  useEffect(() => {
    fetchPod().then(() => {
      // fetchPod sets phase; if still loading after fetch something went wrong
      setPhase((prev) => (prev === 'loading' ? 'idle' : prev))
    })
    return stopPolling
  }, [fetchPod, stopPolling])

  const startLab = useCallback(async () => {
    setError(null)
    setPhase('provisioning')
    stopPolling()

    try {
      await provisioning.provision(studentId, scenarioId)
    } catch (err: unknown) {
      // Axios errors are instanceof Error; check HTTP status before err.message
      // or the scenario page shows "Request failed with status code 409"
      // plus false "environment was automatically cleaned up" copy.
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

    // Start fast polling until ACTIVE
    intervalRef.current = setInterval(fetchPod, 3_000)
  }, [scenarioId, studentId, fetchPod, stopPolling])

  const endSession = useCallback(async () => {
    if (!pod) return
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

  return { phase, pod, error, startLab, endSession, clearError }
}
