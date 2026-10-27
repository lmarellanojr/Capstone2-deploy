import {
  dvwaAutoLogin,
  dvwaSessionBrowserCookies,
  needsDvwaLogin,
  withDvwaSession,
} from './dvwaAutoLogin'

const ORIGIN = 'http://10.0.0.5:18301'
const loginForm = `<form action="login.php" method="post">
  <input type="text" name="username"><input type="password" name="password">
  <input type='hidden' name='user_token' value='tok123' />
</form>`

const redirect = (location: string, cookies: string[] = []) =>
  new Response(null, {
    status: 302,
    headers: [['location', location], ...cookies.map((c) => ['set-cookie', c] as [string, string])],
  })

describe('needsDvwaLogin', () => {
  it('fires only for a GET that DVWA bounced to login.php', () => {
    expect(needsDvwaLogin('GET', '/index.php', redirect('login.php'))).toBe(true)
    expect(needsDvwaLogin('GET', '/vulnerabilities/sqli/', redirect('../../login.php'))).toBe(true)
    expect(needsDvwaLogin('POST', '/vulnerabilities/sqli/', redirect('login.php'))).toBe(false)
    expect(needsDvwaLogin('GET', '/index.php', redirect('index.php'))).toBe(false)
    expect(needsDvwaLogin('GET', '/index.php', new Response('ok', { status: 200 }))).toBe(false)
  })

  it('never signs in on the login, logout or setup pages themselves', () => {
    for (const p of ['/login.php', '/logout.php', '/setup.php']) {
      expect(needsDvwaLogin('GET', p, redirect('login.php'))).toBe(false)
    }
  })
})

describe('dvwaAutoLogin', () => {
  it('reads the CSRF token, posts the lab credentials with Security Low, and returns the session', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(loginForm, { status: 200, headers: [['set-cookie', 'PHPSESSID=first; path=/']] })
      )
      .mockResolvedValueOnce(redirect('index.php', ['PHPSESSID=rotated; path=/']))

    await expect(dvwaAutoLogin(ORIGIN, fetchFn as unknown as typeof fetch)).resolves.toBe('rotated')

    expect(fetchFn.mock.calls[0][0]).toBe(`${ORIGIN}/login.php`)
    const [url, init] = fetchFn.mock.calls[1]
    expect(url).toBe(`${ORIGIN}/login.php`)
    expect(init.method).toBe('POST')
    expect(init.headers.cookie).toBe('PHPSESSID=first; security=low')
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      username: 'admin',
      password: 'password',
      Login: 'Login',
      user_token: 'tok123',
    })
  })

  it('keeps the first session when DVWA does not rotate it', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response(loginForm, { headers: [['set-cookie', 'PHPSESSID=first']] }))
      .mockResolvedValueOnce(redirect('index.php'))
    await expect(dvwaAutoLogin(ORIGIN, fetchFn as unknown as typeof fetch)).resolves.toBe('first')
  })

  it('returns null (manual login fallback) when the login is refused or DVWA is unreachable', async () => {
    const refused = jest
      .fn()
      .mockResolvedValueOnce(new Response(loginForm, { headers: [['set-cookie', 'PHPSESSID=first']] }))
      .mockResolvedValueOnce(redirect('login.php'))
    await expect(dvwaAutoLogin(ORIGIN, refused as unknown as typeof fetch)).resolves.toBeNull()

    const formAgain = jest
      .fn()
      .mockResolvedValueOnce(new Response(loginForm, { headers: [['set-cookie', 'PHPSESSID=first']] }))
      .mockResolvedValueOnce(new Response(loginForm, { status: 200 }))
    await expect(dvwaAutoLogin(ORIGIN, formAgain as unknown as typeof fetch)).resolves.toBeNull()

    const noToken = jest.fn().mockResolvedValueOnce(new Response('<p>setup</p>', { headers: [['set-cookie', 'PHPSESSID=x']] }))
    await expect(dvwaAutoLogin(ORIGIN, noToken as unknown as typeof fetch)).resolves.toBeNull()
    expect(noToken).toHaveBeenCalledTimes(1)

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const down = jest.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(dvwaAutoLogin(ORIGIN, down as unknown as typeof fetch)).resolves.toBeNull()
    warn.mockRestore()
  })
})

describe('session cookies', () => {
  it('swaps the new session and Security Low into the upstream cookie, keeping others', () => {
    expect(withDvwaSession('PHPSESSID=old; security=impossible; other=1', 'new')).toBe(
      'other=1; PHPSESSID=new; security=low'
    )
    expect(withDvwaSession('', 'new')).toBe('PHPSESSID=new; security=low')
  })

  it('scopes the browser cookies to the DVWA proxy path (Lax on an http portal)', () => {
    expect(dvwaSessionBrowserCookies('abc')).toEqual([
      'cr_dvwa_sid=abc; Path=/lab/dvwa/; HttpOnly; SameSite=Lax',
      'security=low; Path=/lab/dvwa/; SameSite=Lax',
    ])
  })

  it('makes them SameSite=None; Secure when the portal allows cross-site cookies (#322)', () => {
    expect(dvwaSessionBrowserCookies('abc', true)).toEqual([
      'cr_dvwa_sid=abc; Path=/lab/dvwa/; HttpOnly; Secure; SameSite=None',
      'security=low; Path=/lab/dvwa/; Secure; SameSite=None',
    ])
  })
})
