'use client'

import { useState, useEffect, useCallback } from 'react'
import { instructor, InstructorStudentDetail } from '@/lib/api'
import { mapErrorToMessage, isForbiddenError, isNotFoundError } from '@/lib/errorHandler'

export function useStudentProgress(studentId: string) {
  const [student, setStudent] = useState<InstructorStudentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const fetchStudent = useCallback(async () => {
    setLoading(true)
    try {
      const result = await instructor.getStudentProgress(studentId)
      setStudent(result)
      setError(null)
      setForbidden(false)
      setNotFound(false)
    } catch (err: unknown) {
      setStudent(null)
      if (isForbiddenError(err)) {
        setForbidden(true)
        setError(null)
        setNotFound(false)
      } else if (isNotFoundError(err)) {
        setNotFound(true)
        setError(null)
        setForbidden(false)
      } else {
        setForbidden(false)
        setNotFound(false)
        setError(mapErrorToMessage(err).message)
      }
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {
    void fetchStudent()
  }, [fetchStudent])

  return { student, loading, error, forbidden, notFound, refresh: fetchStudent }
}
