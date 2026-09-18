'use client'

import { useState, useEffect, useCallback } from 'react'
import { instructor, InstructorStudentSummary } from '@/lib/api'
import { mapErrorToMessage, isForbiddenError } from '@/lib/errorHandler'

export function useInstructorStudents() {
  const [students, setStudents] = useState<InstructorStudentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const fetchStudents = useCallback(async () => {
    setLoading(true)
    try {
      const result = await instructor.listStudents()
      setStudents(result.students || [])
      setError(null)
      setForbidden(false)
    } catch (err: unknown) {
      setStudents([])
      if (isForbiddenError(err)) {
        setForbidden(true)
        setError(null)
      } else {
        setForbidden(false)
        setError(mapErrorToMessage(err).message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStudents()
  }, [fetchStudents])

  return { students, loading, error, forbidden, refresh: fetchStudents }
}
