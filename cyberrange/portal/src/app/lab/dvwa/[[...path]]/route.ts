import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { secureDvwaResponse } from '@/lib/dvwaSecurityPolicy'
import {
  DVWA_LAB_DENIED_HTML,
  cookiesForUpstream,
  dropUpstreamSessionCookie,
  dvwaContentSecurityPolicy,
  dvwaUpstreamOrigin,
  isAllowedDvwaLabPath,
  isDestroyedPhpSession,
  isVulnerableDvwaLabPath,
  injectDvwaEmbeddedStyles,
  rewriteCookie,
  rewriteHtml,
  rewriteLocation,
  rewriteSandboxedThemeUrls,
  safeUpstreamPath,
  shouldRewriteBody,
  stalePhpSessionClearCookies,
  stripDisallowedDvwaMenu,
} from '@/lib/dvwaProxy'
import {
  browserNearMiss,
  browserScoreFailureHint,
  browserScoreLabel,
  detectBrowserMilestone,
  dvwaSecurityLevel,
  injectScoreNotice,
  type NearMiss,
  type ScoreNotice,
} from '@/lib/dvwaScoreSignals'
import {
  dvwaAutoLogin,
  dvwaSessionBrowserCookies,
  needsDvwaLogin,
  withDvwaSession,
} from '@/lib/dvwaAutoLogin'

const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://10.115.77.1:5000'

/** Warn once per process when a real exploit is detected but scoring cannot run. */
let warnedMissingBrowserScoreSecret = false

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

type RouteCtx = { params: Promise<{ path?: string[] }> }

/** Instructor-only near-miss code (Scenario 2 diagnostics). Not awaited: the page
 *  never waits on it, and a failure only loses the reason. The API stores nothing
 *  unless scenario 6 diagnostics are switched on. Only the code is sent.
 */
function postNearMiss(secret: string, studentId: string, podId: number, miss: NearMiss): void {
  fetch(`${API_URL}/internal/browser-diagnostic`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-browser-score-secret': secret },
    body: JSON.stringify({
      student_id: studentId,
      pod_id: podId,
      scenario_id: 6,
      milestone_id: miss.milestone,
      reason: miss.reason,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}

async function ownerActivePodId(accessToken: string | undefined): Promise<number | null> {
  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const res = await fetch(`${API_URL}/pods`, { headers, cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => ({}))) as { pods?: { pod_id: number; status: string }[] }
  const active = (data.pods || []).find((p) => p.status === 'ACTIVE')
  return active?.pod_id ?? null
}

async function proxy(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
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

  // Signed out of DVWA (first visit, expired PHP session): sign in on the
  // student's own pod and replay the request, so the lab opens ready to use.
  let loginCookies: string[] = []
  if (needsDvwaLogin(req.method, upstreamPath, up)) {
    const sid = await dvwaAutoLogin(dvwaUpstreamOrigin(podId))
    if (sid) {
      upstreamCookie = withDvwaSession(upstreamCookie, sid)
      try {
        up = await fetchUp(upstreamCookie)
        loginCookies = dvwaSessionBrowserCookies(sid)
      } catch (err) {
        console.error('dvwa proxy: replay after sign-in failed', upstream, err)
        return new NextResponse(
          'DVWA proxy unreachable. From Kali: curl -sI http://$TARGET_DVWA/  (do not use the host :18301 URL).',
          { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } }
        )
      }
    }
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
  // After DVWA's own cookies so the session we opened is the one that sticks.
  for (const c of loginCookies) {
    out.append('set-cookie', c)
  }

  const csp = dvwaContentSecurityPolicy(upstreamPath)
  if (csp) {
    out.set('content-security-policy', csp)
  }

  if (text !== null) {
    const requestText =
      body && contentType && /application\/x-www-form-urlencoded|text\/plain/i.test(contentType)
        ? new TextDecoder().decode(body)
        : ''
    const milestone =
      up.status === 200
        ? detectBrowserMilestone({
            path: upstreamPath,
            search: req.nextUrl.search,
            method: req.method,
            requestBody: requestText,
            responseText: text,
          })
        : null
    const secret = process.env.BROWSER_SCORE_SECRET
    const studentName = session.user?.name
    if (milestone && !secret && !warnedMissingBrowserScoreSecret) {
      warnedMissingBrowserScoreSecret = true
      console.warn(
        'dvwa proxy: BROWSER_SCORE_SECRET is unset; browser milestone scoring is skipped. ' +
          'Set the same value in portal/.env.local and the provision API env/.env.'
      )
    }
    let scoreNotice: ScoreNotice | null = null
    if (milestone && secret && studentName) {
      const label = browserScoreLabel(milestone)
      // Awaited so a rejected score is shown on this page instead of lost silently.
      // Long-running Node only. Do not move this route to the Edge runtime.
      try {
        const res = await fetch(`${API_URL}/internal/browser-score`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-browser-score-secret': secret,
          },
          body: JSON.stringify({
            student_id: studentName,
            pod_id: podId,
            scenario_id: 6,
            milestone_id: milestone,
            label,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          console.warn(
            `dvwa proxy: browser score rejected (${res.status}) for pod ${podId} milestone ${milestone}: ${detail}`
          )
          scoreNotice = browserScoreFailureHint(res.status, detail)
        }
      } catch (err) {
        // Timeout or network error. The API may still have saved the score.
        console.error('dvwa proxy: browser score failed', err)
        scoreNotice = browserScoreFailureHint(null)
      }
    }
    if (!milestone && up.status === 200 && secret && studentName) {
      const miss = browserNearMiss({
        path: upstreamPath,
        search: req.nextUrl.search,
        requestBody: requestText,
        responseText: text,
        securityLevel: dvwaSecurityLevel(rawCookie || ''),
      })
      if (miss) postNearMiss(secret, studentName, podId, miss)
    }

    out.set('content-type', up.headers.get('content-type') || 'text/html; charset=utf-8')
    let html = rewriteHtml(stripDisallowedDvwaMenu(text))
    if (isVulnerableDvwaLabPath(upstreamPath)) {
      html = rewriteSandboxedThemeUrls(html)
    }
    if ((upType || '').toLowerCase().includes('text/html')) {
      html = injectDvwaEmbeddedStyles(html)
    }
    if (scoreNotice) {
      html = injectScoreNotice(html, scoreNotice)
    }
    return new NextResponse(html, {
      status: up.status,
      headers: out,
    })
  }

  const buf = await up.arrayBuffer()
  return new NextResponse(buf, { status: up.status, headers: out })
}

// One finalization boundary covers upstream content and every local early return.
async function handle(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const response = await proxy(req, ctx)
  const params = await ctx.params
  const path = '/' + (params.path ?? []).join('/')
  return secureDvwaResponse(response, isVulnerableDvwaLabPath(path))
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
