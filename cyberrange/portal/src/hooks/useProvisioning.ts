'use client'

import { useState, useCallback } from 'react'
import { provisioning, ProvisionResponse } from '@/lib/api'
import { mapErrorToMessage } from '@/lib/errorHandler'

export function useProvisioning() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const provision = useCallback(async (studentId: string, scenarioId: string): Promise<ProvisionResponse> => {
    setLoading(true)
    setError(null)
    try {
      const result = await provisioning.provision(studentId, scenarioId)
      return result
    } catch (err: unknown) {
      // Keep the original Axios/HTTP error so callers (overlay, destroy modal)
      // can map 409/503/401 from response.status. Wrapping as `new Error(message)`
      // drops status and falls through to a generic toast.
      const { message } = mapErrorToMessage(err)
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const destroyPod = useCallback(async (podId: number) => {
    setLoading(true)
    setError(null)
    try {
      await provisioning.destroyPod(podId)
    } catch (err: unknown) {
      const { message } = mapErrorToMessage(err)
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return { provision, destroyPod, loading, error, clearError }
}
