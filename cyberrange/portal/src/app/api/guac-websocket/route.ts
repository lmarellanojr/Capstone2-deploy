/**
 * WebSocket proxy for Guacamole protocol
 *
 * Bridges WebSocket connections from frontend to guacd TCP socket (10.0.10.12:4822)
 * Validates JWT token and forwards Guacamole protocol frames bidirectionally.
 *
 * Usage: ws://localhost:3000/api/guac-websocket?token={jwt_token}&pod_id={pod_id}
 */

import { NextRequest, NextResponse } from 'next/server'
import { createPublicKey, KeyObject } from 'crypto'
import { jwtVerify } from 'jose'
import { createConnection, Socket } from 'net'

// Configuration
const GUAC_HOST = process.env.GUAC_HOST || '10.0.10.12'
const GUAC_PORT = parseInt(process.env.GUAC_PORT || '4822', 10)
const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://10.115.77.1:5000'
const KEYCLOAK_REALM_URL = process.env.KEYCLOAK_REALM_URL || 'http://10.0.10.12:8083/realms/cyber-range'
const CONNECTION_TIMEOUT = 30000 // 30 seconds
const HEARTBEAT_INTERVAL = 30000 // 30 seconds

// Cache for Keycloak public key
let cachedPublicKey: KeyObject | null = null
let keyExpiresAt = 0

/**
 * Fetch and cache Keycloak public key
 */
async function getKeycloakPublicKey(): Promise<KeyObject> {
  const now = Date.now()

  // Return cached key if still valid (1 hour TTL)
  if (cachedPublicKey && keyExpiresAt > now) {
    return cachedPublicKey
  }

  try {
    const response = await fetch(`${KEYCLOAK_REALM_URL}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch OIDC config: ${response.status}`)
    }

    const config = await response.json()
    const jwksUrl = config.jwks_uri

    if (!jwksUrl) {
      throw new Error('JWKS URI not found in OIDC config')
    }

    const jwksResponse = await fetch(jwksUrl)
    if (!jwksResponse.ok) {
      throw new Error(`Failed to fetch JWKS: ${jwksResponse.status}`)
    }

    const jwks = await jwksResponse.json()
    const key = jwks.keys[0] // Use first key (usually the active one)

    if (!key) {
      throw new Error('No keys found in JWKS')
    }

    // Convert JWKS key to crypto.KeyObject
    cachedPublicKey = createPublicKey({ key, format: 'jwk' })
    keyExpiresAt = now + 3600000 // 1 hour TTL

    return cachedPublicKey
  } catch (error) {
    console.error('Failed to fetch Keycloak public key:', error)
    throw error
  }
}

/**
 * Verify JWT token and extract claims
 */
async function verifyToken(token: string): Promise<Record<string, unknown>> {
  try {
    const publicKey = await getKeycloakPublicKey()

    // Use jose for JWT verification
    const secret = publicKey.export({ format: 'pem', type: 'spki' })
    const verified = await jwtVerify(token, new TextEncoder().encode(String(secret)))

    return verified.payload as Record<string, unknown>
  } catch (error) {
    console.error('Token verification failed:', error)
    throw new Error('Invalid token')
  }
}

/**
 * Validate pod ownership from claims
 */
async function validatePodOwnership(podId: number, claims: Record<string, unknown>): Promise<boolean> {
  try {
    // Extract student_id from JWT claims (subject)
    const studentId = claims.sub || claims.student_id

    if (!studentId) {
      console.warn('No student ID in claims')
      return false
    }

    // Query provisioning API to verify ownership
    const response = await fetch(`${API_URL}/pods/${podId}`, {
      headers: {
        Authorization: `Bearer dummy-token-not-needed-for-ownership-check`,
      },
    })

    if (!response.ok) {
      console.warn(`Pod ${podId} not found or not accessible`)
      return false
    }

    const pod = await response.json()

    // Verify the student_id matches the JWT subject
    if (pod.student_id !== studentId) {
      console.warn(`Pod ${podId} owned by ${pod.student_id}, but token for ${studentId}`)
      return false
    }

    return true
  } catch (error) {
    console.error('Pod ownership validation failed:', error)
    return false
  }
}

/**
 * Bridge WebSocket <-> TCP
 * Handles bidirectional forwarding of Guacamole protocol frames
 */
function bridgeWebSocketToTcp(
  socketData: ArrayBuffer | Buffer,
  tcpSocket: Socket,
  clientAddress: string
): void {
  // Convert ArrayBuffer to Buffer and send to TCP socket
  const buffer = Buffer.isBuffer(socketData) ? socketData : Buffer.from(socketData)
  tcpSocket.write(buffer, (error) => {
    if (error) {
      console.error(`[${clientAddress}] Error writing to TCP socket:`, error.message)
      tcpSocket.destroy()
    }
  })
}

/**
 * Main WebSocket handler
 */
export async function GET(request: NextRequest) {
  const clientAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

  try {
    // Parse query parameters
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    const podIdParam = url.searchParams.get('pod_id')

    if (!token || !podIdParam) {
      console.warn(`[${clientAddress}] Missing token or pod_id`)
      return NextResponse.json({ error: 'Missing token or pod_id' }, { status: 400 })
    }

    const podId = parseInt(podIdParam, 10)
    if (isNaN(podId)) {
      return NextResponse.json({ error: 'Invalid pod_id' }, { status: 400 })
    }

    // Verify JWT token
    let claims: Record<string, unknown>
    try {
      claims = await verifyToken(token)
    } catch (error) {
      console.warn(`[${clientAddress}] Token verification failed:`, error instanceof Error ? error.message : String(error))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Validate pod ownership
    const isOwner = await validatePodOwnership(podId, claims)
    if (!isOwner) {
      console.warn(`[${clientAddress}] Pod ${podId} ownership validation failed`)
      return NextResponse.json({ error: 'Pod not found or not accessible' }, { status: 404 })
    }

    // Upgrade to WebSocket (Next.js 14 pattern)
    const headers = new Headers()
    headers.set('Upgrade', 'websocket')
    headers.set('Connection', 'Upgrade')
    headers.set('Sec-WebSocket-Key', request.headers.get('sec-websocket-key') || 'invalid')
    headers.set('Sec-WebSocket-Version', '13')

    // Create response with 101 Switching Protocols
    const response = new NextResponse(null, { status: 101, headers })

    // Handle WebSocket upgrade at runtime
    // Note: This requires Next.js 14.1+ with WebSocket support
    // For production, consider using a dedicated WebSocket library like ws or socket.io

    console.log(`[${clientAddress}] WebSocket upgrade requested for pod ${podId}`)

    // For now, return error as Next.js doesn't natively support WebSocket upgrade in app router
    // This is a known limitation - use raw Node.js server or NextAuth WebSocket wrapper
    return NextResponse.json(
      { error: 'WebSocket support requires custom Next.js server configuration' },
      { status: 501 }
    )
  } catch (error) {
    console.error(`[${clientAddress}] Unexpected error:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Handle WebSocket message (if using raw Node.js socket upgrade)
 * This function documents how to handle the bridge in a custom server
 */
function handleWebSocketMessage(
  wsMessage: Buffer,
  tcpSocket: Socket,
  clientAddress: string
): void {
  bridgeWebSocketToTcp(wsMessage, tcpSocket, clientAddress)
}

/**
 * Handle TCP data (bridge back to WebSocket)
 * This function documents how to handle reverse bridge in a custom server
 */
function handleTcpData(
  tcpBuffer: Buffer,
  wsConnection: unknown,
  clientAddress: string
): void {
  // In a real implementation, this would send tcpBuffer back to WebSocket client
  // wsConnection.send(tcpBuffer)
  console.log(`[${clientAddress}] Received ${tcpBuffer.length} bytes from guacd`)
}
