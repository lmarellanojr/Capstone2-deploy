import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import {
  DVWA_LAB_DENIED_HTML,
  cookiesForUpstream,
  dropUpstreamSessionCookie,
  dvwaUpstreamOrigin,
  isAllowedDvwaLabPath,
  isDestroyedPhpSession,
  rewriteCookie,
  rewriteHtml,
  rewriteLocation,
  safeUpstreamPath,
  shouldRewriteBody,
  stalePhpSessionClearCookies,
  stripDisallowedDvwaMenu,
} from '@/lib/dvwaProxy'

const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://10.115.77.1:5000'

try {
  new URL(API_URL)
} catch {
  throw new Error(
    `dvwa proxy: API_URL must be an absolute http(s) URL, got "${API_URL}". Set API_INTERNAL_URL.`
  )
}

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
])

type RouteCtx = { params: Promise<{ path?: string[] }> | { path?: string[] } }

async function ownerActivePodId(accessToken: string | undefined): Promise<number | null> {
  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const res = await fetch(`${API_URL}/pods`, { headers, cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => ({}))) as { pods?: { pod_id: number; status: string }[] }
  const active = (data.pods || []).find((p) => p.status === 'ACTIVE')
  return active?.pod_id ?? null
}

async function handle(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) {
    const login = new URL('/login', 'http://placeholder.invalid')
    login.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`)
    return new NextResponse(null, {
      status: 307,
      headers: { Location: `${login.pathname}${login.search}` },
    })
  }

  let podId: number | null
  try {
    podId = await ownerActivePodId(session.accessToken as string | undefined)
  } catch (err) {
    console.error('dvwa proxy: list pods failed', err)
    return NextResponse.json({ error: 'API unreachable' }, { status: 503 })
  }
  if (!podId) {
    return new NextResponse(
      'No active lab. Start a scenario from the portal, then open DVWA again.',
      { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    )
  }

  const params = await Promise.resolve(ctx.params)
  let upstreamPath: string
  try {
    upstreamPath = safeUpstreamPath(params.path, req.nextUrl.pathname.endsWith('/'))
  } catch {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }

  if (!isAllowedDvwaLabPath(upstreamPath)) {
    return new NextResponse(DVWA_LAB_DENIED_HTML, {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const upstream = `${dvwaUpstreamOrigin(podId)}${upstreamPath}${req.nextUrl.search}`
  const contentType = req.headers.get('content-type')
  const accept = req.headers.get('accept')
  const rawCookie = req.headers.get('cookie')
  let upstreamCookie = rawCookie ? cookiesForUpstream(rawCookie) : ''

  let body: ArrayBuffer | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.arrayBuffer()
  }

  async function fetchUp(cookie: string): Promise<Response> {
    const headers = new Headers()
    if (cookie) headers.set('cookie', cookie)
    if (contentType) headers.set('content-type', contentType)
    if (accept) headers.set('accept', accept)
    return fetch(upstream, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    })
  }

  let up: Response
  try {
    up = await fetchUp(upstreamCookie)
  } catch (err) {
    console.error('dvwa proxy: upstream fetch failed', upstream, err)
    return new NextResponse(
      'DVWA proxy unreachable. From Kali: curl -sI http://$TARGET_DVWA/  (do not use the host :18301 URL).',
      { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    )
  }

  const upType = up.headers.get('content-type')
  let text: string | null = null
  if (shouldRewriteBody(upType) && req.method !== 'HEAD') {
    text = await up.text()
    if (isDestroyedPhpSession(text) && upstreamCookie) {
      try {
        const retry = await fetchUp(dropUpstreamSessionCookie(upstreamCookie))
        up = retry
        const retryType = retry.headers.get('content-type')
        text = shouldRewriteBody(retryType) ? await retry.text() : null
      } catch (err) {
        console.error('dvwa proxy: session retry failed', err)
      }
    }
  }

  const out = new Headers()
  const origin = dvwaUpstreamOrigin(podId)
  const publicHost = req.headers.get('host')?.trim() || undefined
  up.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (HOP.has(lower) || lower === 'set-cookie') return
    if (lower === 'location') {
      out.set('location', rewriteLocation(value, origin, req.nextUrl.pathname, publicHost))
      return
    }
    out.set(key, value)
  })
  const getSetCookie = (up.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const setCookies: string[] =
    typeof getSetCookie === 'function' ? [...getSetCookie.call(up.headers)] : []
  if (setCookies.length === 0) {
    const single = up.headers.get('set-cookie')
    if (single) setCookies.push(single)
  }
  for (const c of setCookies) {
    out.append('set-cookie', rewriteCookie(c))
  }
  for (const c of stalePhpSessionClearCookies()) {
    out.append('set-cookie', c)
  }

  if (text !== null) {
    out.set('content-type', up.headers.get('content-type') || 'text/html; charset=utf-8')
    return new NextResponse(rewriteHtml(stripDisallowedDvwaMenu(text)), {
      status: up.status,
      headers: out,
    })
  }

  const buf = await up.arrayBuffer()
  return new NextResponse(buf, { status: up.status, headers: out })
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx)
}
export async function POST(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx)
}
export async function PUT(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx)
}
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx)
}
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx)
}
export async function HEAD(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx)
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
