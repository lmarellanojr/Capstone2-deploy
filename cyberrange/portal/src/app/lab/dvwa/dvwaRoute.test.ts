import { NextRequest } from 'next/server'

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
import { getServerSession } from 'next-auth'
import { GET } from './[[...path]]/route'

const mockedSession = getServerSession as jest.MockedFunction<typeof getServerSession>
const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

function makeRequest(pathname: string, search = '') {
  return new NextRequest(new URL(`${pathname}${search}`, 'http://localhost:3000'))
}

describe('/lab/dvwa route handler Content-Security-Policy sandbox', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockedSession.mockReset()
  })

  function mockActivePodAndUpstream(upstreamHtml = '<html><body>Mock DVWA</body></html>') {
    mockedSession.mockResolvedValue({ accessToken: 'test-token' } as never)
    // 1st fetch: API /pods returns active pod
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ pods: [{ pod_id: 1, status: 'ACTIVE' }] }),
    } as Response)
    // 2nd fetch: upstream DVWA returns HTML
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => upstreamHtml,
    } as Response)
  }

  it('sets sandbox CSP header when serving /vulnerabilities/xss_r', async () => {
    mockActivePodAndUpstream('<html><body>Hello <script>alert(1)</script></body></html>')
    const req = makeRequest('/lab/dvwa/vulnerabilities/xss_r/')
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'xss_r'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts allow-forms allow-modals'
    )
  })

  it('sets sandbox CSP header when serving /vulnerabilities/sqli', async () => {
    mockActivePodAndUpstream('<html><body>SQL Injection Form</body></html>')
    const req = makeRequest('/lab/dvwa/vulnerabilities/sqli/')
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'sqli'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts allow-forms allow-modals'
    )
  })

  it('does NOT set sandbox CSP header on safe pages like security.php or home', async () => {
    mockActivePodAndUpstream('<html><body>DVWA Security</body></html>')
    const req = makeRequest('/lab/dvwa/security.php')
    const res = await GET(req, { params: Promise.resolve({ path: ['security.php'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  it('rewrites theme URLs to /dvwa-theme/ on vulnerable pages while preserving CSP sandbox', async () => {
    const upstreamHtml = [
      '<html><head>',
      '<link rel="stylesheet" type="text/css" href="/dvwa/css/main.css">',
      '<script type="text/javascript" src="/dvwa/js/dvwaPage.js"></script>',
      '</head><body>',
      '<img src="/dvwa/images/logo.png" />',
      '<h2>Vulnerability: SQL Injection</h2>',
      '</body></html>',
    ].join('')
    mockActivePodAndUpstream(upstreamHtml)
    const req = makeRequest('/lab/dvwa/vulnerabilities/sqli/')
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'sqli'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts allow-forms allow-modals'
    )
    const body = await res.text()
    expect(body).toContain('href="/dvwa-theme/css/main.css"')
    expect(body).toContain('src="/dvwa-theme/js/dvwaPage.js"')
    expect(body).toContain('src="/dvwa-theme/images/logo.png"')
    expect(body).not.toContain('/lab/dvwa/dvwa/css/main.css')
  })

  it('keeps proxied theme URLs on safe pages without mirror rewrite', async () => {
    const upstreamHtml = [
      '<html><head>',
      '<link rel="stylesheet" type="text/css" href="/dvwa/css/main.css">',
      '</head><body>DVWA Security</body></html>',
    ].join('')
    mockActivePodAndUpstream(upstreamHtml)
    const req = makeRequest('/lab/dvwa/security.php')
    const res = await GET(req, { params: Promise.resolve({ path: ['security.php'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBeNull()
    const body = await res.text()
    expect(body).toContain('href="/lab/dvwa/dvwa/css/main.css"')
    expect(body).not.toContain('/dvwa-theme/css/main.css')
  })

  it('rewrites DigiNinja relative theme URLs on sandboxed sqli under CSP sandbox', async () => {
    const upstreamHtml = [
      '<html><head>',
      '<link rel="stylesheet" type="text/css" href="../../dvwa/css/main.css">',
      '<script type="text/javascript" src="../../dvwa/js/dvwaPage.js"></script>',
      '<link rel="icon" href="../../favicon.ico">',
      '</head><body>',
      '<img src="../../dvwa/images/logo.png" />',
      '<form action="../../vulnerabilities/sqli/" method="GET">',
      '<input type="text" name="id" />',
      '<input type="submit" name="Submit" value="Submit" />',
      '</form>',
      '<h2>Vulnerability: SQL Injection</h2>',
      '</body></html>',
    ].join('')
    mockActivePodAndUpstream(upstreamHtml)
    const req = makeRequest('/lab/dvwa/vulnerabilities/sqli/')
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'sqli'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts allow-forms allow-modals'
    )
    expect(res.headers.get('content-security-policy')).not.toMatch(/same-origin/)
    const body = await res.text()
    expect(body).toContain('href="/dvwa-theme/css/main.css"')
    expect(body).toContain('src="/dvwa-theme/js/dvwaPage.js"')
    expect(body).toContain('src="/dvwa-theme/images/logo.png"')
    expect(body).toContain('href="/dvwa-theme/favicon.ico"')
    expect(body).toContain('action="../../vulnerabilities/sqli/"')
    expect(body).not.toContain('../../dvwa/css/main.css')
    expect(body).not.toContain('/lab/dvwa/dvwa/css/main.css')
  })

  it('rewrites DigiNinja relative theme URLs on sandboxed xss_r under CSP sandbox', async () => {
    const upstreamHtml = [
      '<html><head>',
      '<link rel="stylesheet" type="text/css" href="../../dvwa/css/main.css">',
      '<script type="text/javascript" src="../../dvwa/js/dvwaPage.js"></script>',
      '<link rel="icon" href="../../favicon.ico">',
      '</head><body>',
      '<img src="../../dvwa/images/logo.png" />',
      '<form action="../../vulnerabilities/xss_r/" method="GET">',
      '<input type="text" name="name" />',
      '<input type="submit" name="Submit" value="Submit" />',
      '</form>',
      '<h2>Vulnerability: Reflected XSS</h2>',
      '</body></html>',
    ].join('')
    mockActivePodAndUpstream(upstreamHtml)
    const req = makeRequest('/lab/dvwa/vulnerabilities/xss_r/')
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'xss_r'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts allow-forms allow-modals'
    )
    expect(res.headers.get('content-security-policy')).not.toMatch(/same-origin/)
    const body = await res.text()
    expect(body).toContain('href="/dvwa-theme/css/main.css"')
    expect(body).toContain('src="/dvwa-theme/js/dvwaPage.js"')
    expect(body).toContain('src="/dvwa-theme/images/logo.png"')
    expect(body).toContain('href="/dvwa-theme/favicon.ico"')
    expect(body).toContain('action="../../vulnerabilities/xss_r/"')
    expect(body).not.toContain('../../dvwa/css/main.css')
    expect(body).not.toContain('/lab/dvwa/dvwa/css/main.css')
  })

  describe('browser score notice', () => {
    const sqliHit =
      '<html><body><pre>ID: 1\' OR \'1\'=\'1<br />First name: admin<br />Surname: admin</pre>' +
      '<pre>ID: 1\' OR \'1\'=\'1<br />First name: Gordon<br />Surname: Brown</pre></body></html>'
    const search = '?id=1%27+OR+%271%27%3D%271&Submit=Submit'
    const prevSecret = process.env.BROWSER_SCORE_SECRET

    beforeEach(() => {
      process.env.BROWSER_SCORE_SECRET = 'test-secret'
    })
    afterAll(() => {
      process.env.BROWSER_SCORE_SECRET = prevSecret
    })

    async function attack(score: () => void) {
      mockActivePodAndUpstream(sqliHit)
      mockedSession.mockResolvedValue({ accessToken: 'test-token', user: { name: 'student1' } } as never)
      score()
      const req = makeRequest('/lab/dvwa/vulnerabilities/sqli/', search)
      const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'sqli'] }) })
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[2][0]).toMatch(/\/internal\/browser-score$/)
      return res
    }

    it('shows no notice when the score is saved', async () => {
      const res = await attack(() =>
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response)
      )
      expect(res.status).toBe(200)
      expect(await res.text()).not.toContain('data-cr-score-notice')
    })

    it('tells the student to start Scenario 2 on a 409 scenario mismatch', async () => {
      const res = await attack(() =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 409,
          text: async () => '{"detail":"Pod is not on scenario 06"}',
        } as Response)
      )
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('data-cr-score-notice')
      expect(body).toContain('Start Scenario 2')
    })

    it('shows the status code and points to the instructor on a 403', async () => {
      const res = await attack(() =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => '{"detail":"Pod owner mismatch"}',
        } as Response)
      )
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('rejected the request (HTTP 403)')
      expect(body).toContain('tell your instructor')
    })

    it('says the score may not have updated when the scoring call fails', async () => {
      const res = await attack(() =>
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
      )
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('data-cr-score-notice')
      expect(body).toContain('Score may not have updated.')
      expect(body).toContain('Check your score panel')
    })
  })

  it('does not mirror DigiNinja relative theme URLs on safe security.php', async () => {
    const upstreamHtml = [
      '<html><head>',
      '<link rel="stylesheet" type="text/css" href="../../dvwa/css/main.css">',
      '</head><body>DVWA Security</body></html>',
    ].join('')
    mockActivePodAndUpstream(upstreamHtml)
    const req = makeRequest('/lab/dvwa/security.php')
    const res = await GET(req, { params: Promise.resolve({ path: ['security.php'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBeNull()
    const body = await res.text()
    expect(body).toContain('href="../../dvwa/css/main.css"')
    expect(body).not.toContain('/dvwa-theme/css/main.css')
  })
})
