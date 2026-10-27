import {
  DVWA_LAB_COOKIE_MAX_AGE,
  allowsCrossSiteCookies,
  dvwaLabSetCookie,
  isDvwaLabCookieMethod,
  signDvwaLabValue,
  verifyDvwaLabValue,
} from './dvwaLabCookie'

const SECRET = 'lab-cookie-test-secret'
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0)
const EXP = Math.floor(NOW / 1000) + 600

describe('signed DVWA lab cookie (#322)', () => {
  it('round-trips the claims it signed', async () => {
    const value = await signDvwaLabValue(SECRET, { sub: 'student_demo', pod: 3, exp: EXP })
    await expect(verifyDvwaLabValue(SECRET, value, NOW)).resolves.toEqual({
      sub: 'student_demo',
      pod: 3,
      exp: EXP,
    })
  })

  it('rejects another secret, an edited payload and an expired cookie', async () => {
    const value = await signDvwaLabValue(SECRET, { sub: 'student_demo', pod: 3, exp: EXP })
    await expect(verifyDvwaLabValue('other-secret', value, NOW)).resolves.toBeNull()

    const [v, , mac] = value.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'student_other', pod: 3, exp: EXP })).toString('base64url')
    await expect(verifyDvwaLabValue(SECRET, `${v}.${forged}.${mac}`, NOW)).resolves.toBeNull()

    await expect(verifyDvwaLabValue(SECRET, value, EXP * 1000)).resolves.toBeNull()
  })

  it.each([undefined, '', 'garbage', 'v2.a.b', 'v1.!!.??', 'v1.a.b.c'])(
    'rejects malformed value %p',
    async (value) => {
      await expect(verifyDvwaLabValue(SECRET, value, NOW)).resolves.toBeNull()
    },
  )

  it('rejects claims with the wrong shape even when signed', async () => {
    for (const claims of [
      { sub: '', pod: 3, exp: EXP },
      { sub: 'student_demo', pod: 0, exp: EXP },
      { sub: 'student_demo', pod: 1.5, exp: EXP },
    ]) {
      const value = await signDvwaLabValue(SECRET, claims)
      await expect(verifyDvwaLabValue(SECRET, value, NOW)).resolves.toBeNull()
    }
  })

  it('never verifies without a secret', async () => {
    const value = await signDvwaLabValue(SECRET, { sub: 'student_demo', pod: 3, exp: EXP })
    await expect(verifyDvwaLabValue('', value, NOW)).resolves.toBeNull()
  })

  it('scopes the Set-Cookie to the lab path, HttpOnly, Secure and SameSite=None', async () => {
    const header = await dvwaLabSetCookie(SECRET, 'student_demo', 3, NOW)
    expect(header).toMatch(/^cr_dvwa_lab=v1\.[\w-]+\.[\w-]+; /)
    expect(header).toContain(`; Path=/lab/dvwa/; Max-Age=${DVWA_LAB_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=None`)
    const value = header.split(';')[0].slice('cr_dvwa_lab='.length)
    await expect(verifyDvwaLabValue(SECRET, value, NOW)).resolves.toMatchObject({
      sub: 'student_demo',
      pod: 3,
      exp: Math.floor(NOW / 1000) + DVWA_LAB_COOKIE_MAX_AGE,
    })
  })

  it.each([
    ['https://range.example.test', true],
    ['http://localhost:3000', true],
    ['http://127.0.0.1:3000', true],
    ['http://10.115.77.12', false],
    ['http://range.example.test', false],
    ['not a url', false],
  ])('allowsCrossSiteCookies(%s) is %s', (origin, expected) => {
    expect(allowsCrossSiteCookies(origin)).toBe(expected)
  })

  it('only lets page loads and GET form submits use it', () => {
    expect(isDvwaLabCookieMethod('GET')).toBe(true)
    expect(isDvwaLabCookieMethod('HEAD')).toBe(true)
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isDvwaLabCookieMethod(m)).toBe(false)
  })
})
