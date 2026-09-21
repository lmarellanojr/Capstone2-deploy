"use client"

import { useCallback, useEffect, useState } from "react"
import { admin } from "@/lib/api"
import { mapErrorToMessage } from "@/lib/errorHandler"
import {
  InfraHealth,
  unavailableServicesFromError,
} from "@/lib/infraHealth"

export function useAdminInfraHealth() {
  const [data, setData] = useState<InfraHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const body = await admin.getInfraHealth()
      setData(body)
      setError(null)
    } catch (err) {
      const message = mapErrorToMessage(err).message
      setError(message)
      setData({
        capacity: null,
        services: unavailableServicesFromError(message),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
