/**
 * Edge-safe signed lab cookie for Scenario 2 (#322).
 *
 * Vulnerable DVWA modules are served with a CSP sandbox and no
 * allow-same-origin, so a form submit inside the lab pane comes from an opaque
 * origin and the browser drops the SameSite=Lax portal session cookie. This
 * cookie carries only "student X may use DVWA on pod N until T". It is scoped
 * to /lab/dvwa/, holds no Keycloak or NextAuth token, and the proxy re-checks
 * the pod with the API on every request that relies on it (pod ids are reused).
 */
// Same value as DVWA_PREFIX in dvwaProxy.ts; not imported so middleware stays edge-safe.
const DVWA_PREFIX = '/lab/dvwa'

export const DVWA_LAB_COOKIE = 'cr_dvwa_lab'
export const DVWA_LAB_COOKIE_MAX_AGE = 30 * 60

const VERSION = 'v1'
const encoder = new TextEncoder()

export type DvwaLabClaims = { sub: string; pod: number; exp: number }

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

/** Signs `v1.<payload>` so this MAC can never be mistaken for another use of the secret. */
export async function signDvwaLabValue(secret: string, claims: DvwaLabClaims): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)))
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${VERSION}.${payload}`))
  return `${VERSION}.${payload}.${toBase64Url(new Uint8Array(mac))}`
}

/** The claims of a genuine, unexpired cookie value, or null. */
export async function verifyDvwaLabValue(
  secret: string,
  value: string | undefined,
  nowMs = Date.now()
): Promise<DvwaLabClaims | null> {
  if (!secret || !value) return null
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) return null
  const mac = fromBase64Url(parts[2])
  const payload = fromBase64Url(parts[1])
  if (!mac || !payload) return null
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    mac,
    encoder.encode(`${VERSION}.${parts[1]}`)
  )
  if (!ok) return null
  let claims: unknown
  try {
    claims = JSON.parse(new TextDecoder().decode(payload))
  } catch {
    return null
  }
  const c = claims as Partial<DvwaLabClaims>
  if (typeof c.sub !== 'string' || !c.sub) return null
  if (!Number.isInteger(c.pod) || (c.pod as number) < 1) return null
  if (typeof c.exp !== 'number' || c.exp * 1000 <= nowMs) return null
  return { sub: c.sub, pod: c.pod as number, exp: c.exp }
}

/** Set-Cookie for a fresh lab cookie. SameSite=None is what lets the sandboxed submit carry it. */
export async function dvwaLabSetCookie(
  secret: string,
  sub: string,
  pod: number,
  nowMs = Date.now()
): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + DVWA_LAB_COOKIE_MAX_AGE
  const value = await signDvwaLabValue(secret, { sub, pod, exp })
  return `${DVWA_LAB_COOKIE}=${value}; Path=${DVWA_PREFIX}/; Max-Age=${DVWA_LAB_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=None`
}

/** Only page loads and GET form submits may ride on the lab cookie. */
export function isDvwaLabCookieMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}
