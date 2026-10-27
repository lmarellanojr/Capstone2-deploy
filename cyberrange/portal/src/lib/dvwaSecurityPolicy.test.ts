import { isDvwaRequest, secureDefaultResponse, secureDvwaResponse } from './dvwaSecurityPolicy'

describe('DVWA policy finalization', () => {
  it.each(['/lab/dvwa', '/lab/dvwa/', '/lab/dvwa/vulnerabilities/xss_r/'])(
    'recognizes the actual subtree %s', (p) => expect(isDvwaRequest(p)).toBe(true),
  )
  it.each(['/lab/dvwaevil', '/lab/dvwa-theme', '/login'])(
    'does not weaken sibling framing %s', (p) => expect(isDvwaRequest(p)).toBe(false),
  )
  it.each([false, true])('overrides upstream framing and CSP (sandbox=%s)', (sandbox) => {
    const response = new Response('content', { headers: {
      'Content-Security-Policy': "sandbox allow-same-origin; frame-ancestors *",
      'Content-Security-Policy-Report-Only': "default-src *",
      'X-Frame-Options': 'ALLOWALL',
    } })
    const result = secureDvwaResponse(response, sandbox)
    expect(result).toBe(response)
    expect(result.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'")
    expect(result.headers.get('Content-Security-Policy')).not.toContain('allow-same-origin')
    expect(result.headers.get('Content-Security-Policy')!.includes('sandbox')).toBe(sandbox)
    expect(result.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
    expect(result.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('applies default DENY framing on non-DVWA middleware redirects', () => {
    const response = new Response(null, { status: 307, headers: { Location: '/login' } })
    const result = secureDefaultResponse(response)
    expect(result.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
    expect(result.headers.get('X-Frame-Options')).toBe('DENY')
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(result.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })
})
