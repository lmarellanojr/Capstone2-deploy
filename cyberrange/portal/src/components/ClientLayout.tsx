'use client'

import { ReactNode } from 'react'
import { ToastContainer } from '@/components/Toast'
import { useToastContext } from '@/context/ToastContext'

export function ClientLayout({ children }: { children: ReactNode }) {
  const { toasts, remove } = useToastContext()

  return (
    <>
      {children}
      <ToastContainer toasts={toasts} onRemove={remove} />
    </>
  )
}
