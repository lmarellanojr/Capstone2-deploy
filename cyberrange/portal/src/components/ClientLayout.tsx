'use client'

import { ReactNode } from 'react'
import { ToastContainer } from '@/components/Toast'
import { useToastContext } from '@/context/ToastContext'
import { OnboardingGate } from '@/components/auth/OnboardingGate'

export function ClientLayout({ children }: { children: ReactNode }) {
  const { toasts, remove } = useToastContext()

  return (
    <>
      <OnboardingGate>{children}</OnboardingGate>
      <ToastContainer toasts={toasts} onRemove={remove} />
    </>
  )
}
