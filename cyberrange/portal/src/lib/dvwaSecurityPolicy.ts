/** Edge-safe policy shared by middleware redirects and the lab proxy. */
export function isDvwaRequest(pathname: string): boolean {
  return pathname === '/lab/dvwa' || pathname.startsWith('/lab/dvwa/')
}

export const DVWA_FRAME_POLICY = "frame-ancestors 'self'"
export const DVWA_SANDBOX_POLICY = `sandbox allow-scripts allow-forms allow-modals; ${DVWA_FRAME_POLICY}`
export const DEFAULT_FRAME_POLICY = "frame-ancestors 'none'"

/**
 * True when the browser reports this request is for an embedded frame.
 * Top-level Task 1 new-tab navigations send Sec-Fetch-Dest: document — those
 * must not get CSP sandbox (opaque origin breaks DigiNinja / "refused to connect").
 */
export function isDvwaIframeFetch(secFetchDest: string | null | undefined): boolean {
  const dest = (secFetchDest ?? '').trim().toLowerCase()
  return dest === 'iframe' || dest === 'nested-document'
}

/** Vulnerable SQLi/XSS lab paths that may receive the opaque-origin sandbox. */
export function isVulnerableDvwaPolicyPath(path: string): boolean {
  let p = (path || '/').split('?')[0]
  if (p.startsWith('/lab/dvwa')) {
    p = p.slice('/lab/dvwa'.length) || '/'
  }
  p = p.replace(/\/+$/, '') || '/'
  return (
    p === '/vulnerabilities/sqli' ||
    p.startsWith('/vulnerabilities/sqli/') ||
    p === '/vulnerabilities/xss_r' ||
    p.startsWith('/vulnerabilities/xss_r/')
  )
}

/**
 * Sandbox only vulnerable modules loaded inside an iframe.
 * Top-level / missing Sec-Fetch-Dest stays on frame-ancestors only.
 */
export function shouldSandboxDvwaResponse(
  path: string,
  secFetchDest: string | null | undefined,
): boolean {
  return isVulnerableDvwaPolicyPath(path) && isDvwaIframeFetch(secFetchDest)
}

/** Baseline headers for non-DVWA middleware short-circuits (config headers() may not attach). */
export function secureDefaultResponse<T extends Response>(response: T): T {
  response.headers.delete('Content-Security-Policy')
  response.headers.delete('Content-Security-Policy-Report-Only')
  response.headers.delete('X-Frame-Options')
  response.headers.set('Content-Security-Policy', DEFAULT_FRAME_POLICY)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return response
}

/** Finalize after upstream headers are copied; an upstream must not weaken this. */
export function secureDvwaResponse<T extends Response>(response: T, sandbox = false): T {
  response.headers.delete('Content-Security-Policy')
  response.headers.delete('Content-Security-Policy-Report-Only')
  response.headers.delete('X-Frame-Options')
  response.headers.set('Content-Security-Policy', sandbox ? DVWA_SANDBOX_POLICY : DVWA_FRAME_POLICY)
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return response
}
