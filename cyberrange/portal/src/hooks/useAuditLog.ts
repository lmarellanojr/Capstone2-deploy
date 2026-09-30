'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { admin, AuditEvent } from '@/lib/api'
import { backendDetail, isForbiddenError } from '@/lib/errorHandler'

export interface AuditFilters {
  eventType: string
  result: string
  studentId: string
}

const PAGE = 100

export function useAuditLog({ eventType, result, studentId }: AuditFilters) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const seq = useRef(0)

  const load = useCallback(
    async (beforeId?: number) => {
      const mine = ++seq.current
      if (beforeId) setLoadingMore(true)
      else setLoading(true)
      try {
        const page = await admin.listAuditLog({ eventType, result, studentId, beforeId, limit: PAGE })
        if (mine !== seq.current) return // filters changed mid-request
        setEvents((prev) => (beforeId ? [...prev, ...page.events] : page.events))
        setEventTypes(page.event_types)
        setNextBeforeId(page.next_before_id)
        setError(null)
        setForbidden(false)
      } catch (err) {
        if (mine !== seq.current) return
        if (isForbiddenError(err)) setForbidden(true)
        else setError(backendDetail(err))
      } finally {
        if (mine === seq.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [eventType, result, studentId]
  )

  useEffect(() => {
    void load()
  }, [load])

  return {
    events,
    eventTypes,
    loading,
    loadingMore,
    error,
    forbidden,
    hasMore: nextBeforeId !== null,
    loadMore: () => (nextBeforeId ? load(nextBeforeId) : Promise.resolve()),
    refresh: () => load(),
  }
}
