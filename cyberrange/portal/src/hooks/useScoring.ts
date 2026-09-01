'use client'

import { useState, useCallback } from 'react'
import { scoring, Score } from '@/lib/api'

export function useScoring() {
  const [score, setScore] = useState<Score | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getPodScore = useCallback(async (podId: number): Promise<Score> => {
    setLoading(true)
    setError(null)
    try {
      const result = await scoring.getPodScore(podId)
      setScore(result)
      return result
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch pod score'
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const verifyMilestone = useCallback(
    async (milestone: string, podId: number): Promise<{ completed: boolean; points: number; message: string }> => {
      setLoading(true)
      setError(null)
      try {
        const result = await scoring.verifyMilestone(milestone, podId)
        return result
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to verify milestone'
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return { score, getPodScore, verifyMilestone, loading, error, clearError }
}
