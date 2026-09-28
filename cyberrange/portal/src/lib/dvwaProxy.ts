/** Same-origin DVWA prefix and rewrite helpers (no Next rewrite — session is required). */

export const DVWA_PREFIX = '/lab/dvwa'
export const LAB_PROXY_PORT_BASE = 18300

export function dvwaUpstreamOrigin(
  podId: number,
  listen = process.env.LAB_PROXY_LISTEN || '10.115.77.1'
): string {
  if (!Number.isInteger(podId) || podId < 1 || podId > 6) {
    throw new Error(`invalid pod id for DVWA proxy: ${podId}`)
  }
  return `http://${listen}:${LAB_PROXY_PORT_BASE + podId}`
}

export function safeUpstreamPath(segments: string[] | undefined, trailingSlash = false): string {
  const parts = segments ?? []
  if (parts.some((p) => p === '..' || p.includes('\\') || p.includes('\0'))) {
    throw new Error('invalid path')
  }
  if (parts.length === 0) return '/'
  const path = `/${parts.join('/')}`
  if (trailingSlash) return `${path}/`
  return path
}

function pathFromUnusableAbsolute(value: string): string | null {
  try {
    const u = new URL(value)
    if (u.hostname === '0.0.0.0' || u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
      return `${u.pathname}${u.search}${u.hash}` || '/'
    }
  } catch {
    return null
  }
  return null
}

function resolveRelativePath(relative: string, requestPath: string): string {
  // Split paths into segments (preserving leading '' which represents /)
  const segments = requestPath.split('/')
  // If path ends with /, last segment is empty; remove it (directory marker)
  if (segments[segments.length - 1] === '') {
    segments.pop()
  }

  // Apply relative path segments
  const relSegments = relative.split('/')
  for (const seg of relSegments) {
    if (seg === '..') {
      // Go up one level, but preserve root empty segment
      if (segments.length > 1) segments.pop()
    } else if (seg && seg !== '.') {
      segments.push(seg)
    }
  }

  // Reconstruct path (segments[0] is '' for absolute paths)
  return segments.join('/')
}

export function rewriteLocation(value: string, upstreamOrigin: string, requestPath?: string, publicHost?: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  const fromListen = pathFromUnusableAbsolute(trimmed)
  if (fromListen) {
    return rewriteLocation(fromListen, upstreamOrigin, requestPath, publicHost)
  }
  if (trimmed.startsWith(DVWA_PREFIX)) return trimmed
  if (trimmed.startsWith(upstreamOrigin)) {
    const rest = trimmed.slice(upstreamOrigin.length) || '/'
    return rest.startsWith(DVWA_PREFIX) ? rest : `${DVWA_PREFIX}${rest.startsWith('/') ? rest : `/${rest}`}`
  }
  // Rewrite absolute URLs with the public-facing host
  if (publicHost && publicHost.length > 0 && trimmed.startsWith('http://')) {
    try {
      const u = new URL(trimmed)
      if (u.host === publicHost) {
        const pathPart = `${u.pathname}${u.search}${u.hash}` || '/'
        return rewriteLocation(pathPart, upstreamOrigin, requestPath, publicHost)
      }
    } catch {
      // Invalid URL, fall through
    }
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return `${DVWA_PREFIX}${trimmed}`
  }
  // Relative Location: resolve against request path if provided
  if (!/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed) && !trimmed.startsWith('//')) {
    if (requestPath && (trimmed.includes('..') || trimmed.includes('./'))) {
      const resolved = resolveRelativePath(trimmed, requestPath)
      return resolved
    }
    const rel = trimmed.replace(/^\.\//, '')
    return `${DVWA_PREFIX}/${rel}`
  }
  return trimmed
}

/** Browser cookie for DVWA PHP session. Isolates from host-wide PHPSESSID set on :18301. */
export const DVWA_SID_COOKIE = 'cr_dvwa_sid'

export function rewriteCookie(setCookie: string, prefix = DVWA_PREFIX): string {
  let out = setCookie
  if (/^PHPSESSID=/i.test(out)) {
    out = out.replace(/^PHPSESSID=/i, `${DVWA_SID_COOKIE}=`)
  }
  // Host header is the LXD listen IP; Domain=10.115.77.1 is not valid on :3000.
  out = out.replace(/;\s*domain=[^;]*/gi, '')
  if (/;\s*path=/i.test(out)) {
    return out.replace(/;\s*path=[^;]*/i, `; Path=${prefix}/`)
  }
  return `${out}; Path=${prefix}/`
}

/** Expire the host-wide PHPSESSID left by the old :18301 Open DVWA URL. */
export function stalePhpSessionClearCookies(): string[] {
  return [
    'PHPSESSID=; Path=/; Max-Age=0',
    `PHPSESSID=; Path=${DVWA_PREFIX}/; Max-Age=0`,
  ]
}

export function isDestroyedPhpSession(body: string): boolean {
  return /Failed to decode session object/i.test(body)
}

export function rewriteHtml(html: string, prefix = DVWA_PREFIX): string {
  const attrs = html.replace(
    /\b(href|src|action)=(["'])\/(?!lab\/dvwa(?:\/|$)|api\/|_next\/|auth\/)/gi,
    `$1=$2${prefix}/`
  )
  return attrs.replace(
    /url\((['"]?)\/(?!lab\/dvwa(?:\/|$)|api\/|_next\/|auth\/)/gi,
    `url($1${prefix}/`
  )
}

export function cookiesForUpstream(cookieHeader: string): string {
  const forwarded: string[] = []
  for (const part of cookieHeader.split(';').map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    const name = eq === -1 ? part : part.slice(0, eq)
    const value = eq === -1 ? '' : part.slice(eq + 1)
    if (
      name.startsWith('next-auth') ||
      name.startsWith('__Secure-next-auth') ||
      name.startsWith('__Host-next-auth')
    ) {
      continue
    }
    // Port is not cookie-isolated: :18301 PHPSESSID is also sent to :3000.
    if (name === 'PHPSESSID') continue
    if (name === DVWA_SID_COOKIE) {
      forwarded.push(`PHPSESSID=${value}`)
      continue
    }
    forwarded.push(part)
  }
  return forwarded.join('; ')
}

export function dropUpstreamSessionCookie(cookieHeader: string): string {
  return cookieHeader
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((part) => !/^PHPSESSID=/i.test(part))
    .join('; ')
}

function normalizeLabPath(path: string): string {
  let p = (path.split('?')[0] || '/').trim()
  if (p.startsWith(DVWA_PREFIX)) {
    p = p.slice(DVWA_PREFIX.length) || '/'
  }
  if (!p.startsWith('/')) p = `/${p}`
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p.toLowerCase()
}

/** Scenario 06 only: home, login, security Low, SQL Injection, Reflected XSS, static. */
export function isAllowedDvwaLabPath(path: string): boolean {
  const p = normalizeLabPath(path)
  if (p === '/' || p === '/index.php' || p === '/login.php' || p === '/logout.php') return true
  if (p === '/security.php' || p === '/favicon.ico') return true
  if (p === '/dvwa' || p.startsWith('/dvwa/')) return true
  if (p === '/vulnerabilities/sqli' || p.startsWith('/vulnerabilities/sqli/')) return true
  if (p === '/vulnerabilities/xss_r' || p.startsWith('/vulnerabilities/xss_r/')) return true
  return false
}

export function stripDisallowedDvwaMenu(html: string): string {
  return html.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, (li) => {
    const href = li.match(/href\s*=\s*["']([^"']+)["']/i)
    if (!href) return li
    const raw = href[1]
    if (/^https?:/i.test(raw) || raw.startsWith('#') || raw === '.' || raw === './') return li
    return isAllowedDvwaLabPath(raw) ? li : ''
  })
}

export const DVWA_LAB_DENIED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Not in this lab</title></head>
<body>
<p>This page is not part of Scenario 06.</p>
<p>Use <a href="${DVWA_PREFIX}/">Home</a>,
<a href="${DVWA_PREFIX}/security.php">DVWA Security (set Low)</a>,
<a href="${DVWA_PREFIX}/vulnerabilities/sqli/">SQL Injection</a>, or
<a href="${DVWA_PREFIX}/vulnerabilities/xss_r/">XSS (Reflected)</a>.</p>
</body></html>
`

export function shouldRewriteBody(contentType: string | null): boolean {
  if (!contentType) return false
  const ct = contentType.toLowerCase()
  return ct.includes('text/html') || ct.includes('text/css') || ct.includes('application/javascript')
}

/**
 * Security: Identifies vulnerable DVWA modules that execute untrusted student payloads.
 */
export function isVulnerableDvwaLabPath(path: string): boolean {
  const p = normalizeLabPath(path)
  if (p === '/vulnerabilities/sqli' || p.startsWith('/vulnerabilities/sqli/')) return true
  if (p === '/vulnerabilities/xss_r' || p.startsWith('/vulnerabilities/xss_r/')) return true
  return false
}

/**
 * Security: Serves vulnerable module pages in an opaque origin (origin: null) via CSP sandbox.
 * Prevents reflected XSS or SQLi payloads from accessing portal cookies, local storage,
 * or calling authenticated portal APIs (e.g. /api/auth/session) while allowing script execution,
 * modal dialogs (alert/confirm/prompt), and GET form submissions.
 */
export function dvwaContentSecurityPolicy(path: string): string | null {
  if (isVulnerableDvwaLabPath(path)) {
    return 'sandbox allow-scripts allow-forms allow-modals'
  }
  return null
}

/** Public, unauthenticated Next.js static prefix for DVWA theme assets. */
export const DVWA_THEME_PUBLIC_PREFIX = '/dvwa-theme'

/**
 * Retarget proxied theme URLs to the public mirror.
 * Call only on HTML for vulnerable modules (after rewriteHtml).
 */
export function rewriteSandboxedThemeUrls(html: string, prefix = DVWA_PREFIX): string {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // /lab/dvwa/dvwa/{css|images|js}/... → /dvwa-theme/{css|images|js}/...
  let out = html.replace(
    new RegExp(`${esc}/dvwa/(css|images|js)/`, 'gi'),
    `${DVWA_THEME_PUBLIC_PREFIX}/$1/`
  )
  // optional favicon
  out = out.replace(
    new RegExp(`${esc}/favicon\\.ico`, 'gi'),
    `${DVWA_THEME_PUBLIC_PREFIX}/favicon.ico`
  )
  return out
}
