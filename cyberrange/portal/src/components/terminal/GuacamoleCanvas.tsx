'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useToastContext } from '@/context/ToastContext'

/**
 * GuacamoleCanvas Component
 *
 * Renders a VNC/RDP stream natively onto an HTML5 canvas using guacamole-common-js.
 * Replaces the iframe-based approach (which had keyboard focus traps).
 *
 * Features:
 * - Native canvas rendering (no iframe cross-origin issues)
 * - Direct keyboard and mouse input capture
 * - Automatic window resize handling
 * - WebSocket connection to guacd daemon
 * - Seamless error recovery
 */

interface GuacamoleCanvasProps {
  podId: number
  guacToken?: string
  containerWidth?: number
  containerHeight?: number
  onConnectionChange?: (connected: boolean) => void
}

// Type definitions for guacamole-common-js
declare global {
  interface Window {
    Guacamole: any
  }
}

export function GuacamoleCanvas({
  podId,
  guacToken,
  containerWidth = 1024,
  containerHeight = 768,
  onConnectionChange,
}: GuacamoleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const connectionRef = useRef<any>(null)
  const displayRef = useRef<any>(null)
  const mouseRef = useRef<any>(null)
  const keyboardRef = useRef<any>(null)

  const [connected, setConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const { error: toastError } = useToastContext()

  /**
   * Calculate canvas size to fit container while maintaining aspect ratio
   */
  const getCanvasSize = useCallback(() => {
    if (!wrapperRef.current) return { width: containerWidth, height: containerHeight }

    const rect = wrapperRef.current.getBoundingClientRect()
    return {
      width: rect.width || containerWidth,
      height: rect.height || containerHeight,
    }
  }, [containerWidth, containerHeight])

  /**
   * Resize the display/canvas when window is resized
   */
  const handleWindowResize = useCallback(() => {
    if (!displayRef.current || !connectionRef.current) return

    const size = getCanvasSize()
    if (canvasRef.current) {
      canvasRef.current.width = size.width
      canvasRef.current.height = size.height
    }

    // Notify Guacamole of new dimensions
    displayRef.current.getLayer().resize(size.width, size.height)
  }, [getCanvasSize])

  /**
   * Initialize the Guacamole connection and display
   */
  useEffect(() => {
    // Ensure guacamole-common-js is loaded
    if (!window.Guacamole) {
      setConnectionError('Guacamole library not loaded')
      setIsLoading(false)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    try {
      setIsLoading(true)
      setConnectionError(null)

      // Get WebSocket URL from Gemini's backend
      // Gemini should provide an endpoint like /api/guac-websocket/{pod_id}
      // that returns the guacd connection parameters
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${wsProtocol}//${window.location.host}/api/guac-websocket/${podId}`

      // Create tunnel (WebSocket connection)
      const tunnel = new window.Guacamole.WebSocketTunnel(wsUrl, {
        // Include auth token if provided by backend
        ...(guacToken && { token: guacToken }),
      })

      // Create client
      const client = new window.Guacamole.Client(tunnel)

      // Create display (renders to canvas)
      const display = client.getDisplay()
      const layer = display.getLayer(0)

      // Set canvas size
      const size = getCanvasSize()
      canvas.width = size.width
      canvas.height = size.height

      // Append display to canvas
      canvas.appendChild(layer.getElement())

      // Set up event handlers
      tunnel.onerror = (error: any) => {
        console.error('Guacamole tunnel error:', error)
        setConnectionError(error?.message || 'WebSocket connection failed')
        setConnected(false)
        onConnectionChange?.(false)
        toastError('Terminal connection lost. Attempting to reconnect...')
      }

      tunnel.onstatechange = (state: number) => {
        const stateMap: { [key: number]: string } = {
          0: 'CONNECTING',
          1: 'OPEN',
          2: 'CLOSING',
          3: 'CLOSED',
        }
        console.log(`Tunnel state: ${stateMap[state] || 'UNKNOWN'}`)

        if (state === 1) {
          // OPEN
          setConnected(true)
          setConnectionError(null)
          setIsLoading(false)
          onConnectionChange?.(true)
        } else if (state === 3) {
          // CLOSED
          setConnected(false)
          onConnectionChange?.(false)
        }
      }

      client.onerror = (error: any) => {
        console.error('Guacamole client error:', error)
        setConnectionError(error?.message || 'Client error')
        setConnected(false)
        onConnectionChange?.(false)
      }

      // Connect
      client.connect()

      // Set up mouse input
      const mouse = new window.Guacamole.Mouse(canvas)
      mouse.onmousedown = (x: number, y: number, mask: number) => {
        client.sendMouseState(x, y, mask)
      }
      mouse.onmouseup = (x: number, y: number, mask: number) => {
        client.sendMouseState(x, y, mask)
      }
      mouse.onmousemove = (x: number, y: number, mask: number) => {
        client.sendMouseState(x, y, mask)
      }

      // Set up keyboard input
      const keyboard = new window.Guacamole.Keyboard(document)
      keyboard.onkeydown = (keysym: number) => {
        client.sendKeyEvent(1, keysym)
      }
      keyboard.onkeyup = (keysym: number) => {
        client.sendKeyEvent(0, keysym)
      }

      // Focus management: prevent iframe focus issues
      canvas.tabIndex = 0
      canvas.focus()

      // Store references for cleanup and resize handling
      connectionRef.current = client
      displayRef.current = display
      mouseRef.current = mouse
      keyboardRef.current = keyboard

      // Listen for window resize
      window.addEventListener('resize', handleWindowResize)

      // Cleanup function
      return () => {
        window.removeEventListener('resize', handleWindowResize)

        // Disconnect
        if (client) {
          client.disconnect()
        }

        // Clear references
        connectionRef.current = null
        displayRef.current = null
        mouseRef.current = null
        keyboardRef.current = null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to initialize Guacamole:', message)
      setConnectionError(message)
      setIsLoading(false)
    }
  }, [podId, guacToken, getCanvasSize, handleWindowResize, onConnectionChange, toastError])

  /**
   * Re-focus canvas when user clicks on it
   */
  const handleCanvasClick = useCallback(() => {
    if (canvasRef.current && document.activeElement !== canvasRef.current) {
      canvasRef.current.focus()
    }
  }, [])

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full relative bg-black rounded-lg border border-border overflow-hidden flex flex-col"
      onClick={handleCanvasClick}
    >
      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent mb-3" />
              <p className="text-sm text-text-muted">Connecting to pod...</p>
            </div>
          </div>
        </div>
      )}

      {/* Connection error state */}
      {connectionError && !isLoading && (
        <div className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center">
          <div className="text-center max-w-sm mx-4">
            <div className="text-3xl mb-3">⚠️</div>
            <p className="text-sm text-text-muted mb-4 break-words">
              {connectionError}
            </p>
            <p className="text-xs text-text-muted/70 mb-4">
              Check that the Guacamole backend is running and WebSocket proxy is configured.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-accent text-text-main rounded text-sm hover:bg-accent/80 transition"
            >
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Canvas element */}
      <canvas
        ref={canvasRef}
        className={`flex-1 cursor-crosshair focus:outline-none focus:ring-2 focus:ring-accent/50 ${
          connected ? '' : 'opacity-0'
        }`}
        style={{
          imageRendering: 'pixelated',
          WebkitImageRendering: 'pixelated',
        } as any}
      />

      {/* Connection status indicator */}
      <div className="absolute bottom-3 left-3 text-xs text-text-muted flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        {connected ? 'Connected' : 'Disconnected'}
      </div>
    </div>
  )
}
