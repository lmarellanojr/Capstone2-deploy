'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { provisioning } from '@/lib/api'
import { Milestone } from '@/hooks/useScenarios'
import { useToastContext } from '@/context/ToastContext'
import {
  passedMilestoneIdsForScenario,
  scenarioProgressKey,
} from '@/lib/scenarioCompletion'

export function useScenarioMilestones(
  podId: number | null,
  scenarioId: string | undefined,
  milestones: Milestone[]
) {
  const { success, warning, error: toastError } = useToastContext()
  const successRef = useRef(success)
  successRef.current = success
  const warningRef = useRef(warning)
  warningRef.current = warning
  const toastErrorRef = useRef(toastError)
  toastErrorRef.current = toastError

  const [completed, setCompleted] = useState<Set<number>>(new Set())
  const [lockedReview, setLockedReview] = useState<Set<number>>(new Set())
  const [verifying, setVerifying] = useState<Set<number>>(new Set())
  const [milestonesLoading, setMilestonesLoading] = useState(true)
  const [loadedProgressKey, setLoadedProgressKey] = useState<string | null>(null)

  const currentProgressKey = podId && scenarioId ? scenarioProgressKey(podId, scenarioId) : null
  const currentProgressKeyRef = useRef(currentProgressKey)
  currentProgressKeyRef.current = currentProgressKey

  const prevPassedRef = useRef<Set<number>>(new Set())
  const milestonesRef = useRef(milestones)
  milestonesRef.current = milestones

  // Reset state and fetch initial milestones when pod or scenario changes
  useEffect(() => {
    if (!podId || !scenarioId || !currentProgressKey) {
      setCompleted(new Set())
      setLockedReview(new Set())
      setVerifying(new Set())
      setLoadedProgressKey(null)
      setMilestonesLoading(false)
      prevPassedRef.current = new Set()
      return
    }

    let active = true
    const requestKey = currentProgressKey

    setCompleted(new Set())
    setLockedReview(new Set())
    setVerifying(new Set())
    setLoadedProgressKey(null)
    setMilestonesLoading(true)
    prevPassedRef.current = new Set()

    provisioning.getMilestones(podId).then((res) => {
      if (!active || currentProgressKeyRef.current !== requestKey) return
      if (res && res.milestones) {
        const passed = passedMilestoneIdsForScenario(res.milestones, scenarioId)
        setCompleted(passed)
        prevPassedRef.current = new Set(passed)
      }
      setLockedReview(new Set(res?.manual_check_locked ?? []))
      setLoadedProgressKey(requestKey)
      setMilestonesLoading(false)
    }).catch((err) => {
      if (!active || currentProgressKeyRef.current !== requestKey) return
      console.error('Failed to fetch initial milestones:', err)
      toastErrorRef.current('Could not load previous progress - showing current session only.')
      setLoadedProgressKey(requestKey)
      setMilestonesLoading(false)
    })

    return () => {
      active = false
    }
  }, [podId, scenarioId, currentProgressKey])

  // Single polling interval: check for newly scored milestones every 3s
  useEffect(() => {
    if (!podId || !scenarioId || !currentProgressKey) return

    let active = true
    const requestKey = currentProgressKey

    const interval = setInterval(async () => {
      try {
        const res = await provisioning.getMilestones(podId)
        if (!active || currentProgressKeyRef.current !== requestKey || !res?.milestones) return

        setLockedReview(new Set(res.manual_check_locked ?? []))
        const newPassed = passedMilestoneIdsForScenario(res.milestones, scenarioId)

        const freshPassed: number[] = []
        newPassed.forEach((mid) => {
          if (!prevPassedRef.current.has(mid)) {
            freshPassed.push(mid)
            prevPassedRef.current.add(mid)
          }
        })

        if (freshPassed.length > 0) {
          setCompleted(new Set(newPassed))
          freshPassed.forEach((mid) => {
            const pts = milestonesRef.current.find((m) => m.id === mid)?.points ?? 0
            successRef.current(`Task auto-detected! +${pts} pts`)
          })
        }
      } catch (err: any) {
        // Stop polling on 401/403/404 terminal auth/session errors
        const status = err?.response?.status || err?.status
        if (status === 401 || status === 403 || status === 404) {
          clearInterval(interval)
        }
      }
    }, 3000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [podId, scenarioId, currentProgressKey])

  const handleVerify = useCallback(async (milestoneId: number) => {
    if (!podId || !scenarioId || completed.has(milestoneId)) return
    const requestKey = currentProgressKeyRef.current
    setVerifying((prev) => new Set(prev).add(milestoneId))

    try {
      const result = await provisioning.verifyMilestone(podId, scenarioId, milestoneId)
      if (currentProgressKeyRef.current !== requestKey) return

      if (result.status === 'PASS') {
        setCompleted((prev) => {
          const next = new Set(prev).add(milestoneId)
          prevPassedRef.current.add(milestoneId)
          return next
        })
        const pts = milestonesRef.current.find((m) => m.id === milestoneId)?.points ?? 0
        let msg = `Task complete! +${pts} pts`
        if (result.detection_score && result.detection_score > 0) {
          msg += ` (Real Alert Bonus${result.detection_data ? `: ${result.detection_data}` : ''})`
        }
        successRef.current(msg)
      } else if (result.status === 'FAIL') {
        setLockedReview((prev) => new Set(prev).add(milestoneId))
        warningRef.current(
          result.message ||
            "Manual Check couldn't verify this task. You can now ask an instructor to review it."
        )
      } else if (result.status === 'REVIEW') {
        setLockedReview((prev) => new Set(prev).add(milestoneId))
        warningRef.current(
          result.message ||
            'Your Manual Check has already been used. Ask an instructor to review this task.'
        )
      } else {
        toastErrorRef.current('Verification unavailable - your terminal is still working.')
      }
    } catch {
      toastErrorRef.current('Verification unavailable - your terminal is still working.')
    } finally {
      setVerifying((prev) => {
        const next = new Set(prev)
        next.delete(milestoneId)
        return next
      })
    }
  }, [podId, scenarioId, completed])

  const onFlagPassed = useCallback((milestoneId: number) => {
    setCompleted((prev) => {
      const next = new Set(prev).add(milestoneId)
      prevPassedRef.current.add(milestoneId)
      return next
    })
  }, [])

  const totalPoints = useMemo(
    () => milestones.reduce((sum, m) => sum + m.points, 0),
    [milestones]
  )
  const earnedPoints = useMemo(
    () => milestones.filter((m) => completed.has(m.id)).reduce((sum, m) => sum + m.points, 0),
    [milestones, completed]
  )
  const doneCount = useMemo(
    () => milestones.filter((m) => completed.has(m.id)).length,
    [milestones, completed]
  )
  const nextMilestoneId = useMemo(
    () => (milestonesLoading ? undefined : milestones.find((m) => !completed.has(m.id))?.id),
    [milestones, completed, milestonesLoading]
  )
  const progressPct = useMemo(
    () => (totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0),
    [earnedPoints, totalPoints]
  )

  return {
    completed,
    lockedReview,
    verifying,
    milestonesLoading,
    loadedProgressKey,
    currentProgressKey,
    earnedPoints,
    totalPoints,
    doneCount,
    progressPct,
    nextMilestoneId,
    handleVerify,
    onFlagPassed,
  }
}
