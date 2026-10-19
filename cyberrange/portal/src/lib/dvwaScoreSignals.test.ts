import {
  browserNearMiss,
  browserScoreFailureHint,
  browserScoreLabel,
  detectBrowserMilestone,
  dvwaSecurityLevel,
  idValue,
  injectScoreNotice,
} from './dvwaScoreSignals'

const sqli = '/vulnerabilities/sqli/'
const xssr = '/vulnerabilities/xss_r/'
const chrome = '<html><title>DVWA</title><pre>'
function page(rows: string): string {
  return `${chrome}${rows}</pre><a href="/dvwa/">DVWA</a></html>`
}
const oneUser = 'ID: 1<br />First name: admin<br />Surname: admin<br />'
const twoUsers =
  oneUser + 'ID: 2<br />First name: gordon<br />Surname: brown<br />'
const hashRow =
  "ID: 1' UNION SELECT user, password FROM users -- -<br />First name: admin<br />Surname: 5f4dcc3b5aa765d61d8327deb882cf99<br />"
const dbRow =
  "ID: 1' UNION SELECT null, database() -- -<br />First name: <br />Surname: dvwa<br />"

function hit(over: Partial<Parameters<typeof detectBrowserMilestone>[0]>) {
  return detectBrowserMilestone({
    path: sqli,
    search: '',
    method: 'GET',
    requestBody: '',
    responseText: page(oneUser),
    ...over,
  })
}

describe('dvwaScoreSignals', () => {
  describe('detectBrowserMilestone (sqli)', () => {
    it('bare visit does not score', () => {
      expect(hit({ responseText: page('<h1>SQL Injection</h1>') })).toBeNull()
    })

    it('id=1 with a single user row does not score', () => {
      expect(hit({ search: '?id=1&Submit=Submit' })).toBeNull()
    })

    it('HTML tags in the page do not erase a real OR payload', () => {
      expect(
        hit({
          search: "?id=1'+OR+'1'%3D'1&Submit=Submit",
          responseText: page(twoUsers),
        }),
      ).toBe(1)
    })

    it("1' with a SQL syntax error scores milestone 1", () => {
      expect(
        hit({
          search: '?id=1%27&Submit=Submit',
          responseText: page('You have an error in your SQL syntax; check the manual'),
        }),
      ).toBe(1)
    })

    it('UNION database() scores milestone 2 from the surname cell, not the header', () => {
      expect(
        hit({
          search: '?id=' + encodeURIComponent("1' UNION SELECT null, database() -- -"),
          responseText: page(dbRow),
        }),
      ).toBe(2)
    })

    it('the word dvwa in the header alone does not score milestone 2', () => {
      expect(
        hit({
          search: '?id=' + encodeURIComponent("1' UNION SELECT null, database() -- -"),
          responseText: page(oneUser),
        }),
      ).toBeNull()
    })

    it('UNION FROM users with a 32-hex surname scores milestone 3', () => {
      expect(
        hit({
          search: '?id=' + encodeURIComponent("1' UNION SELECT user, password FROM users -- -"),
          responseText: page(hashRow),
        }),
      ).toBe(3)
    })

    it('placeholder token in the id does not score', () => {
      expect(
        hit({
          search: '?id=' + encodeURIComponent("1' OR '<session_id>'='<session_id>'"),
          responseText: page(twoUsers),
        }),
      ).toBeNull()
    })
  })

  describe('detectBrowserMilestone (xss_r)', () => {
    it('escaped Hello &lt;script does not score milestone 4', () => {
      expect(
        hit({
          path: xssr,
          search: '?name=' + encodeURIComponent('<script>alert(1)</script>'),
          responseText: page('Hello &lt;script&gt;alert(1)&lt;/script&gt;'),
        }),
      ).toBeNull()
    })

    it('raw Hello <script with name payload scores milestone 4', () => {
      expect(
        hit({
          path: xssr,
          search: '?name=' + encodeURIComponent('<script>alert(1)</script>'),
          responseText: page('Hello <script>alert(1)</script>'),
        }),
      ).toBe(4)
    })
  })

  describe('browserScoreLabel', () => {
    it('returns sqli labels for milestones 1–3 and xss-m4 for 4', () => {
      expect(browserScoreLabel(1)).toBe('browser:sqli-m1')
      expect(browserScoreLabel(2)).toBe('browser:sqli-m2')
      expect(browserScoreLabel(3)).toBe('browser:sqli-m3')
      expect(browserScoreLabel(4)).toBe('browser:xss-m4')
    })
  })

  describe('idValue', () => {
    it('keeps an unencoded equals sign inside id', () => {
      expect(idValue("?id=1'+OR+'1'='1&Submit=Submit", '')).toBe("1' OR '1'='1")
    })
  })
})

describe('browserScoreFailureHint', () => {
  it('names Scenario 2 when the active lab is another scenario', () => {
    expect(browserScoreFailureHint(409, 'Pod is not on scenario 06').message).toMatch(/different scenario.*Start Scenario 2/)
  })
  it('explains an inactive lab', () => {
    expect(browserScoreFailureHint(409, 'Pod not active (status: EXPIRED)').message).toMatch(/not active/)
  })
  it.each([400, 401, 403, 404, 500, 503])('reports HTTP %p as rejected and points to the instructor', (status) => {
    const hint = browserScoreFailureHint(status, 'Pod owner mismatch')
    expect(hint.title).toBe('Score not updated.')
    expect(hint.message).toContain(`rejected the request (HTTP ${status})`)
    expect(hint.message).toMatch(/tell your instructor/)
    expect(hint.message).not.toMatch(/did not respond/)
  })
  it('says the score may have updated after a timeout or network error', () => {
    const hint = browserScoreFailureHint(null)
    expect(hint.title).toBe('Score may not have updated.')
    expect(hint.message).toMatch(/did not respond in time.*may not have updated.*Check your score panel/)
  })
})

describe('injectScoreNotice', () => {
  const notice = { title: 'Score not updated.', message: 'hi' }
  it('inserts the notice right after <body>', () => {
    const out = injectScoreNotice('<html><body class="home"><h1>x</h1></body></html>', notice)
    expect(out).toMatch(/<body class="home"><div role="alert" data-cr-score-notice[^>]*><strong>Score not updated.<\/strong> hi<\/div><h1>/)
  })
  it('prepends when there is no <body>', () => {
    expect(injectScoreNotice('<pre>x</pre>', notice)).toMatch(/^<div role="alert"[\s\S]*<\/div><pre>x<\/pre>$/)
  })
  it('escapes the title and message', () => {
    const out = injectScoreNotice('<body>', { title: '<i>', message: '<b>"x"</b>' })
    expect(out).toContain('<strong>&lt;i&gt;</strong> &lt;b&gt;&quot;x&quot;&lt;/b&gt;')
  })
})

describe('dvwaSecurityLevel', () => {
  it('reads the security cookie and ignores look-alike names', () => {
    expect(dvwaSecurityLevel('cr_dvwa_sid=abc; security=Medium')).toBe('medium')
    expect(dvwaSecurityLevel('xsecurity=high; cr_dvwa_sid=abc')).toBe('')
    expect(dvwaSecurityLevel('')).toBe('')
  })
})

describe('browserNearMiss', () => {
  type Input = Parameters<typeof browserNearMiss>[0]
  function miss(over: Partial<Input>) {
    const input: Input = {
      path: sqli,
      search: '',
      requestBody: '',
      responseText: page(oneUser),
      securityLevel: 'low',
      ...over,
    }
    // The route only asks when the detector found nothing for the same request.
    expect(detectBrowserMilestone({ ...input, method: 'GET' })).toBeNull()
    return browserNearMiss(input)
  }

  it.each([
    ['a bare visit', {}],
    ['a plain id', { search: '?id=1&Submit=Submit' }],
    ['a placeholder id', { search: "?id=%3Cadmin_hash_here%3E'&Submit=Submit" }],
    ['a UNION on a table the detector has no rule for', { search: "?id=1'+UNION+SELECT+a,b+FROM+guestbook--+-" }],
    ['another DVWA page', { path: '/vulnerabilities/exec/', search: "?id=1'" }],
    ['a plain XSS name', { path: xssr, search: '?name=alice' }],
    ['a placeholder XSS name', { path: xssr, search: '?name=%3Cscript%3E%3Csession_id%3E' }],
  ])('stays generic for %s', (_label, over) => {
    expect(miss(over as Partial<Input>)).toBeNull()
  })

  it.each([
    ["OR 1=1 with one row", "?id=1'+OR+'1'%3D'1", 1, 'PAYLOAD_NO_ROWS'],
    ["a quote with no SQL error", '?id=1%27', 1, 'QUOTE_NO_ERROR'],
    ['UNION database() with no dvwa cell', "?id=1'+UNION+SELECT+null,database()--+-", 2, 'UNION_NO_METADATA'],
    ['UNION information_schema with no match', "?id=1'+UNION+SELECT+1,table_name+FROM+information_schema.tables--+-", 2, 'UNION_NO_METADATA'],
    ['UNION FROM users with no hash', "?id=1'+UNION+SELECT+user,first_name+FROM+users--+-", 3, 'UNION_NO_HASH'],
  ])('%s', (_label, search, milestone, reason) => {
    expect(miss({ search: search as string })).toEqual({ milestone, reason })
  })

  it('reads the id from a POST body too', () => {
    expect(miss({ requestBody: "id=1'+OR+1%3D1&Submit=Submit" })).toEqual({ milestone: 1, reason: 'PAYLOAD_NO_ROWS' })
  })

  it('names a non-Low security cookie first, on the milestone the payload targets', () => {
    expect(miss({ search: "?id=1'+UNION+SELECT+user,first_name+FROM+users--+-", securityLevel: 'high' })).toEqual({
      milestone: 3,
      reason: 'SECURITY_NOT_LOW',
    })
    expect(miss({ path: xssr, search: '?name=%3Cscript%3Ealert(1)%3C/script%3E', securityLevel: 'medium', responseText: page('Hello alert(1)') })).toEqual({
      milestone: 4,
      reason: 'SECURITY_NOT_LOW',
    })
  })

  it('does not guess the security level when the cookie is absent', () => {
    expect(miss({ search: '?id=1%27', securityLevel: '' })).toEqual({ milestone: 1, reason: 'QUOTE_NO_ERROR' })
  })

  it('reports an unreflected script for milestone 4', () => {
    expect(
      miss({ path: xssr, search: '?name=%3Cscript%3Ealert(1)%3C/script%3E', responseText: page('Hello &lt;script&gt;') }),
    ).toEqual({ milestone: 4, reason: 'XSS_NOT_REFLECTED' })
  })
})
