import { NextRequest } from 'next/server'

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
import { getServerSession } from 'next-auth'
import { GET, HEAD } from './[[...path]]/route'

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

  it.each([307, 503, 404, 400, 403, 502])('finalizes the %s early response', async (status) => {
    mockedSession.mockResolvedValue(status === 307 ? null : { accessToken: 'test-token' } as never)
    if (status === 503) fetchMock.mockRejectedValueOnce(new Error('offline fixture'))
    else if (status !== 307) fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pods: status === 404 ? [] : [{ pod_id: 1, status: 'ACTIVE' }] }),
    })
    if (status === 502) fetchMock.mockRejectedValueOnce(new Error('upstream fixture'))
    const path = status === 400 ? ['..'] : status === 403 ? ['setup.php'] : ['index.php']
    const response = await GET(makeRequest('/lab/dvwa/' + path.join('/')), { params: Promise.resolve({ path }) })
    expect(response.status).toBe(status)
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })

  it('keeps the sandbox for HEAD and overwrites hostile upstream policy', async () => {
    mockedSession.mockResolvedValue({ accessToken: 'test-token' } as never)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ pods: [{ pod_id: 1, status: 'ACTIVE' }] }) })
    fetchMock.mockResolvedValueOnce(new Response(null, { headers: {
      'content-security-policy': "sandbox allow-same-origin; frame-ancestors *",
      'x-frame-options': 'ALLOWALL',
    } }))
    const response = await HEAD(makeRequest('/lab/dvwa/vulnerabilities/xss_r/'), {
      params: Promise.resolve({ path: ['vulnerabilities', 'xss_r'] }),
    })
    expect(response.headers.get('content-security-policy')).toBe("sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'")
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })

  it('sets sandbox CSP header when serving /vulnerabilities/xss_r', async () => {
    mockActivePodAndUpstream('<html><body>Hello <script>alert(1)</script></body></html>')
    const req = makeRequest('/lab/dvwa/vulnerabilities/xss_r/')
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'xss_r'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'"
    )
  })

  it('sets sandbox CSP header when serving /vulnerabilities/sqli', async () => {
    mockActivePodAndUpstream('<html><body>SQL Injection Form</body></html>')
    const req = makeRequest('/lab/dvwa/vulnerabilities/sqli/')
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'sqli'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'"
    )
  })

  it('does NOT set sandbox CSP header on safe pages like security.php or home', async () => {
    mockActivePodAndUpstream('<html><body>DVWA Security</body></html>')
    const req = makeRequest('/lab/dvwa/security.php')
    const res = await GET(req, { params: Promise.resolve({ path: ['security.php'] }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
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
      "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'"
    )
    const body = await res.text()
    expect(body).toContain('href="/dvwa-theme/css/main.css"')
    expect(body).toContain('href="/dvwa-theme/css/embedded.css"')
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
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
    const body = await res.text()
    expect(body).toContain('href="/lab/dvwa/dvwa/css/main.css"')
    expect(body).toContain('href="/dvwa-theme/css/embedded.css"')
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
      "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'"
    )
    expect(res.headers.get('content-security-policy')).not.toMatch(/same-origin/)
    const body = await res.text()
    expect(body).toContain('href="/dvwa-theme/css/main.css"')
    expect(body).toContain('href="/dvwa-theme/css/embedded.css"')
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
      "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'"
    )
    expect(res.headers.get('content-security-policy')).not.toMatch(/same-origin/)
    const body = await res.text()
    expect(body).toContain('href="/dvwa-theme/css/main.css"')
    expect(body).toContain('href="/dvwa-theme/css/embedded.css"')
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
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
    const body = await res.text()
    expect(body).toContain('href="../../dvwa/css/main.css"')
    expect(body).toContain('href="/dvwa-theme/css/embedded.css"')
    expect(body).not.toContain('/dvwa-theme/css/main.css')
  })
})

describe('/lab/dvwa automatic sign-in', () => {
  const loginForm = "<form><input type='hidden' name='user_token' value='tok' /></form>"
  const redirect = (location: string, cookies: string[] = []) =>
    new Response(null, {
      status: 302,
      headers: [['location', location], ...cookies.map((c) => ['set-cookie', c] as [string, string])],
    })

  beforeEach(() => {
    fetchMock.mockReset()
    mockedSession.mockReset()
    mockedSession.mockResolvedValue({ accessToken: 'test-token' } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ pods: [{ pod_id: 1, status: 'ACTIVE' }] }),
    } as Response)
  })

  it('signs in on the student pod and serves the page they asked for, with Security Low', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('login.php'))
      .mockResolvedValueOnce(new Response(loginForm, { headers: [['set-cookie', 'PHPSESSID=s1; path=/']] }))
      .mockResolvedValueOnce(redirect('index.php'))
      .mockResolvedValueOnce(
        new Response('<html><body>Welcome to DVWA</body></html>', {
          status: 200,
          headers: [['content-type', 'text/html']],
        })
      )

    const res = await GET(makeRequest('/lab/dvwa/index.php'), {
      params: Promise.resolve({ path: ['index.php'] }),
    })

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Welcome to DVWA')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    const origin = urls[1].replace(/\/index\.php$/, '')
    expect(urls.slice(2, 4)).toEqual([`${origin}/login.php`, `${origin}/login.php`])
    expect(urls[4]).toBe(urls[1])
    expect(fetchMock.mock.calls[4][1].headers.get('cookie')).toBe('PHPSESSID=s1; security=low')
    const cookies = res.headers.getSetCookie()
    expect(cookies).toContain('cr_dvwa_sid=s1; Path=/lab/dvwa/; HttpOnly; SameSite=Lax')
    expect(cookies).toContain('security=low; Path=/lab/dvwa/; SameSite=Lax')
  })

  it("falls back to DVWA's own login redirect when sign-in fails", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('login.php'))
      .mockResolvedValueOnce(new Response(loginForm, { headers: [['set-cookie', 'PHPSESSID=s1']] }))
      .mockResolvedValueOnce(redirect('login.php'))

    const res = await GET(makeRequest('/lab/dvwa/index.php'), {
      params: Promise.resolve({ path: ['index.php'] }),
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/\/lab\/dvwa\/login\.php$/)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('cr_dvwa_sid='))).toBe(false)
  })

  it('leaves the login page itself alone', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(loginForm, { status: 200, headers: [['content-type', 'text/html']] })
    )
    const res = await GET(makeRequest('/lab/dvwa/login.php'), {
      params: Promise.resolve({ path: ['login.php'] }),
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('replays a payload GET bounced by an expired session once, at Low, and still scores it', async () => {
    const prevSecret = process.env.BROWSER_SCORE_SECRET
    process.env.BROWSER_SCORE_SECRET = 'test-secret'
    mockedSession.mockResolvedValue({ accessToken: 'test-token', user: { name: 'student1' } } as never)
    const sqliHit =
      "<html><body><pre>ID: 1' OR '1'='1<br />First name: admin<br />Surname: admin</pre>" +
      "<pre>ID: 1' OR '1'='1<br />First name: Gordon<br />Surname: Brown</pre></body></html>"
    const search = '?id=1%27+OR+%271%27%3D%271&Submit=Submit'
    try {
      fetchMock
        .mockResolvedValueOnce(redirect('../../login.php'))
        .mockResolvedValueOnce(new Response(loginForm, { headers: [['set-cookie', 'PHPSESSID=s2']] }))
        .mockResolvedValueOnce(redirect('index.php'))
        .mockResolvedValueOnce(
          new Response(sqliHit, { status: 200, headers: [['content-type', 'text/html']] })
        )
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response)

      const res = await GET(makeRequest('/lab/dvwa/vulnerabilities/sqli/', search), {
        params: Promise.resolve({ path: ['vulnerabilities', 'sqli'] }),
      })

      expect(res.status).toBe(200)
      const urls = fetchMock.mock.calls.map((c) => String(c[0]))
      // pods, bounced payload, login form, login POST, one replay, score
      expect(fetchMock).toHaveBeenCalledTimes(6)
      expect(urls[4]).toBe(urls[1])
      expect(urls[4]).toContain(search)
      expect(fetchMock.mock.calls[4][1].headers.get('cookie')).toBe('PHPSESSID=s2; security=low')
      expect(urls[5]).toMatch(/\/internal\/browser-score$/)
      expect(JSON.parse(fetchMock.mock.calls[5][1].body)).toMatchObject({ milestone_id: 1, scenario_id: 6 })
    } finally {
      process.env.BROWSER_SCORE_SECRET = prevSecret
    }
  })
})
