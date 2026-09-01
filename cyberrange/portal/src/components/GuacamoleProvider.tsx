'use client'

import { useEffect, ReactNode } from 'react'

/**
 * GuacamoleProvider
 *
 * Ensures guacamole-common-js is loaded and available globally.
 * This must wrap any components that use GuacamoleCanvas.
 */

export function GuacamoleProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // guacamole-common-js v1.5.0 is an ES module (`export default Guacamole`) and does
    // NOT register a global itself, so we assign window.Guacamole explicitly. The default
    // export is the Guacamole namespace (Client, WebSocketTunnel, Mouse, Keyboard, ...).
    // @ts-ignore - package ships no types for the global
    import('guacamole-common-js')
      .then((mod) => {
        ;(window as any).Guacamole = (mod as any).default ?? mod
      })
      .catch((err) => {
        console.error('Failed to load Guacamole library:', err)
      })
  }, [])

  return <>{children}</>
}
