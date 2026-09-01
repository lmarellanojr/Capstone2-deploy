'use client'

import { SessionProvider } from 'next-auth/react'
import { ReactNode } from 'react'
import { ToastProvider } from '@/context/ToastContext'
import { GuacamoleProvider } from '@/components/GuacamoleProvider'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      // Poll /api/auth/session every 4 min (< the 5-min access-token lifespan) so the
      // next-auth jwt callback fires, refreshes the Keycloak token, and resets the
      // 30-min SSO idle — keeping the session alive (to the 10h max) even during long
      // web-terminal/WebSocket use that otherwise reads the session. Fixes "Session Expired".
      refetchInterval={240}
      refetchOnWindowFocus={true}
    >
      <ToastProvider>
        <GuacamoleProvider>
          {children}
        </GuacamoleProvider>
      </ToastProvider>
    </SessionProvider>
  )
}
