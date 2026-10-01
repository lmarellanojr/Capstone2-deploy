'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { admin, AdminUser, AppRole, CreateUserInput } from '@/lib/api'
import { backendDetail, isForbiddenError } from '@/lib/errorHandler'

// ADM-USER: replaces the page's old fixture data. Writes return the updated
// user, which is patched into the list in place — no full reload, so the
// table never flashes back to a spinner after a toggle.
export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  // user id -> in-flight write, so only that row's controls disable.
  const [pending, setPending] = useState<Record<string, 'enabled' | 'role' | 'password'>>({})
  const search = useRef('')
  const requestSeq = useRef(0)

  const fetchUsers = useCallback(async (query?: string) => {
    if (query !== undefined) search.current = query
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const result = await admin.listUsers(search.current)
      if (seq !== requestSeq.current) return // a newer search superseded this one
      setUsers(result.users || [])
      setError(null)
      setForbidden(false)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setUsers([])
      if (isForbiddenError(err)) {
        setForbidden(true)
        setError(null)
      } else {
        setForbidden(false)
        setError(backendDetail(err))
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  const replace = (updated: AdminUser) =>
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))

  /** Throws a user-safe message string on failure. */
  const runWrite = async (userId: string, kind: 'enabled' | 'role' | 'password', call: () => Promise<AdminUser>) => {
    setPending((p) => ({ ...p, [userId]: kind }))
    try {
      replace(await call())
    } catch (err) {
      throw new Error(backendDetail(err))
    } finally {
      setPending((p) => {
        const next = { ...p }
        delete next[userId]
        return next
      })
    }
  }

  const setEnabled = (userId: string, enabled: boolean) =>
    runWrite(userId, 'enabled', () => admin.setUserEnabled(userId, enabled))

  const setRole = (userId: string, role: AppRole) => runWrite(userId, 'role', () => admin.setUserRole(userId, role))

  const resetPassword = (userId: string, password: string, temporary: boolean) =>
    runWrite(userId, 'password', () => admin.resetUserPassword(userId, password, temporary))

  /** Throws a user-safe message string on failure. */
  const createUser = async (input: CreateUserInput): Promise<AdminUser> => {
    try {
      const created = await admin.createUser(input)
      setUsers((prev) => [created, ...prev.filter((u) => u.id !== created.id)])
      return created
    } catch (err) {
      throw new Error(backendDetail(err))
    }
  }

  return {
    users,
    loading,
    error,
    forbidden,
    pending,
    search: fetchUsers,
    refresh: () => fetchUsers(),
    setEnabled,
    setRole,
    resetPassword,
    createUser,
  }
}
