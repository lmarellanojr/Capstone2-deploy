import {
  browserScoreFailureHint,
  browserScoreLabel,
  detectBrowserMilestone,
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
    expect(browserScoreFailureHint(409, 'Pod is not on scenario 06')).toMatch(/different scenario.*Start Scenario 2/)
  })
  it('explains an inactive lab', () => {
    expect(browserScoreFailureHint(409, 'Pod not active (status: EXPIRED)')).toMatch(/not active/)
  })
  it.each([401, 503, 500, null])('falls back to a service message for %p', (status) => {
    expect(browserScoreFailureHint(status)).toMatch(/scoring service did not respond/)
  })
})

describe('injectScoreNotice', () => {
  it('inserts the notice right after <body>', () => {
    const out = injectScoreNotice('<html><body class="home"><h1>x</h1></body></html>', 'hi')
    expect(out).toMatch(/<body class="home"><div role="alert" data-cr-score-notice[^>]*><strong>Score not updated.<\/strong> hi<\/div><h1>/)
  })
  it('prepends when there is no <body>', () => {
    expect(injectScoreNotice('<pre>x</pre>', 'hi')).toMatch(/^<div role="alert"[\s\S]*<\/div><pre>x<\/pre>$/)
  })
  it('escapes the message', () => {
    expect(injectScoreNotice('<body>', '<b>"x"</b>')).toContain('&lt;b&gt;&quot;x&quot;&lt;/b&gt;')
  })
})
