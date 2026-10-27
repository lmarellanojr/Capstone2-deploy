/** Edge-safe policy shared by middleware redirects and the lab proxy. */
export function isDvwaRequest(pathname: string): boolean {
  return pathname === '/lab/dvwa' || pathname.startsWith('/lab/dvwa/')
}

export const DVWA_FRAME_POLICY = "frame-ancestors 'self'"
export const DVWA_SANDBOX_POLICY = `sandbox allow-scripts allow-forms allow-modals; ${DVWA_FRAME_POLICY}`
export const DEFAULT_FRAME_POLICY = "frame-ancestors 'none'"

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
