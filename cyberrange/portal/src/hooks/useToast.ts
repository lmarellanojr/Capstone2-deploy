'use client'

import { useCallback, useState } from 'react'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
  duration?: number
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, variant: ToastVariant = 'info', duration = 3000) => {
    const id = Math.random().toString(36).substr(2, 9)
    const toast: Toast = { id, message, variant, duration }

    setToasts((prev) => [...prev, toast])

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }

    return id
  }, [])

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const success = useCallback((message: string, duration?: number) => {
    return show(message, 'success', duration)
  }, [show])

  const error = useCallback((message: string, duration?: number) => {
    return show(message, 'error', duration)
  }, [show])

  const info = useCallback((message: string, duration?: number) => {
    return show(message, 'info', duration)
  }, [show])

  const warning = useCallback((message: string, duration?: number) => {
    return show(message, 'warning', duration)
  }, [show])

  return { toasts, show, remove, success, error, info, warning }
}
