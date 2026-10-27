import { NextRequest } from 'next/server'

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
import { getServerSession } from 'next-auth'
import { GET, HEAD, POST } from './[[...path]]/route'
import { signDvwaLabValue, verifyDvwaLabValue } from '@/lib/dvwaLabCookie'

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

  it('keeps sandbox CSP on a top-level document fetch (Sec-Fetch-Dest: document)', async () => {
    mockActivePodAndUpstream('<html><body>XSS</body></html>')
    const req = new NextRequest(new URL('/lab/dvwa/vulnerabilities/xss_r/', 'http://localhost:3000'), {
      headers: { 'sec-fetch-dest': 'document' },
    })
    const res = await GET(req, { params: Promise.resolve({ path: ['vulnerabilities', 'xss_r'] }) })

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
    expect(cookies).toContain('cr_dvwa_sid=s1; Path=/lab/dvwa/; HttpOnly; Secure; SameSite=None')
    expect(cookies).toContain('security=low; Path=/lab/dvwa/; Secure; SameSite=None')
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

describe('/lab/dvwa signed lab cookie for sandboxed submits (#322)', () => {
  const ENV = { ...process.env }
  const AUTH = 'route-lab-auth-secret'
  const SANDBOX = "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'"
  const SQLI = ['vulnerabilities', 'sqli']

  beforeEach(() => {
    fetchMock.mockReset()
    mockedSession.mockReset()
    mockedSession.mockResolvedValue(null)
    process.env = { ...ENV, NEXTAUTH_SECRET: AUTH, BROWSER_SCORE_SECRET: 'test-secret' }
  })
  afterAll(() => {
    process.env = ENV
  })

  async function labCookie(sub = 'student_demo', pod = 3, secret = AUTH) {
    const value = await signDvwaLabValue(secret, { sub, pod, exp: Math.floor(Date.now() / 1000) + 600 })
    return `cr_dvwa_lab=${value}`
  }

  function submit(cookie: string, method = 'GET') {
    return new NextRequest(
      new URL("/lab/dvwa/vulnerabilities/sqli/?id=1'+OR+'1'%3D'1&Submit=Submit", 'http://localhost:3000'),
      { method, headers: { cookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' } }
    )
  }

  function upstreamHtml() {
    return new Response('<html><body>ID: 1 First name: admin</body></html>', {
      status: 200,
      headers: [['content-type', 'text/html']],
    })
  }

  it('serves a cookieless in-pane submit on the pod the API confirms, still sandboxed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"status":"OK"}', { status: 200 }))
    fetchMock.mockResolvedValueOnce(upstreamHtml())
    // Near-miss diagnostic (fire-and-forget) for this non-scoring page.
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const res = await GET(submit(await labCookie()), { params: Promise.resolve({ path: SQLI }) })

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('First name: admin')
    expect(res.headers.get('content-security-policy')).toBe(SANDBOX)
    const [checkUrl, checkInit] = fetchMock.mock.calls[0]
    expect(String(checkUrl)).toMatch(/\/internal\/browser-pod-check$/)
    expect(checkInit.headers['x-browser-score-secret']).toBe('test-secret')
    expect(JSON.parse(checkInit.body)).toEqual({ student_id: 'student_demo', pod_id: 3 })
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/:18303\/vulnerabilities\/sqli\/\?id=/)
    // No /pods call: the cookie path never has (or needs) a Keycloak token.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => /\/pods$/.test(u))).toBe(false)
    // Diagnostics run as the cookie's student, as they would with a session.
    const diag = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/internal/browser-diagnostic'))
    expect(diag).toBeDefined()
    expect(JSON.parse(diag![1].body)).toMatchObject({ student_id: 'student_demo', pod_id: 3 })
    // Never renewed without a session: the cookie keeps the exp it was minted with.
    expect(res.headers.getSetCookie().some((c) => c.startsWith('cr_dvwa_lab='))).toBe(false)
  })

  it.each([403, 404, 409, 503])('sends the submit to /login when the pod check returns %s', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }))

    const res = await GET(submit(await labCookie()), { params: Promise.resolve({ path: SQLI }) })

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/^\/login\?callbackUrl=/)
    expect(res.headers.get('content-security-policy')).toBe(SANDBOX)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the submit to /login when the pod check is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('api offline'))
    const res = await GET(submit(await labCookie()), { params: Promise.resolve({ path: SQLI }) })
    expect(res.status).toBe(307)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a cookie signed with another secret, without calling the API', async () => {
    const res = await GET(submit(await labCookie('student_demo', 3, 'not-the-secret')), {
      params: Promise.resolve({ path: SQLI }),
    })
    expect(res.status).toBe(307)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores the cookie for POST', async () => {
    const res = await POST(submit(await labCookie(), 'POST'), { params: Promise.resolve({ path: SQLI }) })
    expect(res.status).toBe(307)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores the cookie when BROWSER_SCORE_SECRET is unset (no way to re-check the pod)', async () => {
    delete process.env.BROWSER_SCORE_SECRET
    const res = await GET(submit(await labCookie()), { params: Promise.resolve({ path: SQLI }) })
    expect(res.status).toBe(307)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('issues the cookie for the signed-in student and their active pod', async () => {
    mockedSession.mockResolvedValue({ accessToken: 't', user: { name: 'student_demo' } } as never)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ pods: [{ pod_id: 2, status: 'ACTIVE' }] }) })
    fetchMock.mockResolvedValueOnce(upstreamHtml())

    const res = await GET(makeRequest('/lab/dvwa/index.php'), { params: Promise.resolve({ path: ['index.php'] }) })

    expect(res.status).toBe(200)
    const header = res.headers.getSetCookie().find((c) => c.startsWith('cr_dvwa_lab='))
    expect(header).toBeDefined()
    const value = header!.split(';')[0].slice('cr_dvwa_lab='.length)
    await expect(verifyDvwaLabValue(AUTH, value)).resolves.toMatchObject({ sub: 'student_demo', pod: 2 })
  })

  it('on an http portal, issues no lab cookie and keeps DVWA cookies Lax', async () => {
    mockedSession.mockResolvedValue({ accessToken: 't', user: { name: 'student_demo' } } as never)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ pods: [{ pod_id: 2, status: 'ACTIVE' }] }) })
    fetchMock.mockResolvedValueOnce(
      new Response('<html><body>Home</body></html>', {
        status: 200,
        headers: [['content-type', 'text/html'], ['set-cookie', 'PHPSESSID=s9; path=/']],
      })
    )
    delete process.env.NEXTAUTH_URL
    const req = new NextRequest(new URL('/lab/dvwa/index.php', 'http://10.115.77.12'))

    const res = await GET(req, { params: Promise.resolve({ path: ['index.php'] }) })

    const cookies = res.headers.getSetCookie()
    expect(cookies.some((c) => c.startsWith('cr_dvwa_lab='))).toBe(false)
    expect(cookies).toContain('cr_dvwa_sid=s9; Path=/lab/dvwa/')
    expect(cookies.join(' | ')).not.toMatch(/Secure|SameSite=None/)
  })

  it('on an https portal, issues the lab cookie and SameSite=None DVWA cookies', async () => {
    mockedSession.mockResolvedValue({ accessToken: 't', user: { name: 'student_demo' } } as never)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ pods: [{ pod_id: 2, status: 'ACTIVE' }] }) })
    fetchMock.mockResolvedValueOnce(
      new Response('<html><body>Home</body></html>', {
        status: 200,
        headers: [['content-type', 'text/html'], ['set-cookie', 'PHPSESSID=s9; path=/']],
      })
    )
    const req = new NextRequest(new URL('/lab/dvwa/index.php', 'https://range.example.test'), {
      headers: { host: 'range.example.test', 'x-forwarded-proto': 'https' },
    })

    const res = await GET(req, { params: Promise.resolve({ path: ['index.php'] }) })

    const cookies = res.headers.getSetCookie()
    expect(cookies.find((c) => c.startsWith('cr_dvwa_lab='))).toMatch(/; Secure; SameSite=None$/)
    expect(cookies).toContain('cr_dvwa_sid=s9; Path=/lab/dvwa/; Secure; SameSite=None')
  })

  it('issues no cookie when the session has no student name', async () => {
    mockActivePodAndUpstreamForLab()
    const res = await GET(makeRequest('/lab/dvwa/index.php'), { params: Promise.resolve({ path: ['index.php'] }) })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('cr_dvwa_lab='))).toBe(false)
  })

  function mockActivePodAndUpstreamForLab() {
    mockedSession.mockResolvedValue({ accessToken: 't' } as never)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ pods: [{ pod_id: 1, status: 'ACTIVE' }] }) })
    fetchMock.mockResolvedValueOnce(upstreamHtml())
  }
})
