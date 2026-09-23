"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import axios from "axios"
import { admin } from "@/lib/api"
import { mapErrorToMessage } from "@/lib/errorHandler"
import {
  InfraHealth,
  servicesFromFetchFailure,
} from "@/lib/infraHealth"

const POLL_MS = 30_000

export function useAdminInfraHealth() {
  const [data, setData] = useState<InfraHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const reqId = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const body = await admin.getInfraHealth()
      if (id !== reqId.current) return
      setData(body)
      setError(null)
      setCheckedAt(new Date())
    } catch (err) {
      if (id !== reqId.current) return
      const message = mapErrorToMessage(err).message
      const httpStatus = axios.isAxiosError(err) ? err.response?.status : undefined
      const apiDetail = axios.isAxiosError(err) ? err.response?.data?.detail : undefined
      setError(message)
      setData({
        capacity: null,
        services: servicesFromFetchFailure(message, httpStatus, apiDetail),
      })
      setCheckedAt(new Date())
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return
      }
      void refresh()
    }
    const id = window.setInterval(tick, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh])

  return { data, loading, error, refresh, checkedAt }
}
