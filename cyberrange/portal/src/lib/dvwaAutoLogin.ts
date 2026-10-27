import { DVWA_PREFIX, DVWA_SID_COOKIE } from '@/lib/dvwaProxy'

// Scenario 2 signs the student in to their own pod's DVWA so the lab opens
// ready to use: no login form and no security-level choice before the first
// payload. These are DVWA's stock lab credentials (already printed in the
// guide), and the proxy only ever talks to the requester's own pod.
const DVWA_USER = 'admin'
const DVWA_PASSWORD = 'password'

/** Upstream cookie that pins DVWA's security level; DVWA reads it per request. */
export const DVWA_SECURITY_COOKIE = 'security=low'

const TOKEN_RE = /name=["']user_token["'][^>]*value=["']([^"']+)["']/i
const NO_LOGIN_PATHS = /^\/(login|logout|setup)\.php$/i

function setCookiesOf(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof h.getSetCookie === 'function') return [...h.getSetCookie.call(res.headers)]
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

function sessionIdOf(res: Response): string | null {
  for (const c of setCookiesOf(res)) {
    const m = /^PHPSESSID=([^;]*)/i.exec(c)
    if (m && m[1]) return m[1]
  }
  return null
}

function redirectsToLogin(res: Response): boolean {
  if (res.status < 300 || res.status >= 400) return false
  const loc = res.headers.get('location') || ''
  return /(^|\/)login\.php(\?|$)/i.test(loc)
}

/**
 * True when DVWA bounced a page load to its login form: a GET for anything
 * other than the login/logout/setup pages that came back as a redirect to
 * login.php. Only then is it safe to sign in on the student's behalf.
 */
export function needsDvwaLogin(method: string, upstreamPath: string, res: Response): boolean {
  if (method !== 'GET') return false
  if (NO_LOGIN_PATHS.test(upstreamPath.split('?')[0])) return false
  return redirectsToLogin(res)
}

/**
 * Log in to DVWA at `origin` with a fresh PHP session and return its id, or
 * null if any step fails (the caller then serves DVWA's own login page, which
 * is exactly today's manual flow).
 */
export async function dvwaAutoLogin(
  origin: string,
  fetchFn: typeof fetch = fetch
): Promise<string | null> {
  try {
    const form = await fetchFn(`${origin}/login.php`, {
      headers: { cookie: DVWA_SECURITY_COOKIE },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    let sid = sessionIdOf(form)
    const token = TOKEN_RE.exec(await form.text())?.[1]
    if (!sid || !token) return null

    const body = new URLSearchParams({
      username: DVWA_USER,
      password: DVWA_PASSWORD,
      Login: 'Login',
      user_token: token,
    })
    const login = await fetchFn(`${origin}/login.php`, {
      method: 'POST',
      headers: {
        cookie: `PHPSESSID=${sid}; ${DVWA_SECURITY_COOKIE}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    // Success is a redirect away from login.php; a failed login re-renders the
    // form (200) or bounces back to login.php.
    if (login.status < 300 || login.status >= 400 || redirectsToLogin(login)) return null
    sid = sessionIdOf(login) ?? sid
    return sid
  } catch (err) {
    console.warn('dvwa proxy: automatic sign-in failed; serving the login page', err)
    return null
  }
}

/** Upstream cookie header with the new session and Security Low swapped in. */
export function withDvwaSession(upstreamCookie: string, sid: string): string {
  const rest = upstreamCookie
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !/^(PHPSESSID|security)=/i.test(p))
  return [...rest, `PHPSESSID=${sid}`, DVWA_SECURITY_COOKIE].join('; ')
}

/**
 * Browser cookies that keep the student on the session we just opened.
 * `crossSite` (#322, https only): a submit from a sandboxed module in the lab
 * pane is cross-site, and a Lax DVWA session would drop and force a new sign-in.
 */
export function dvwaSessionBrowserCookies(sid: string, crossSite = false): string[] {
  const site = crossSite ? 'Secure; SameSite=None' : 'SameSite=Lax'
  return [
    `${DVWA_SID_COOKIE}=${sid}; Path=${DVWA_PREFIX}/; HttpOnly; ${site}`,
    `${DVWA_SECURITY_COOKIE}; Path=${DVWA_PREFIX}/; ${site}`,
  ]
}
