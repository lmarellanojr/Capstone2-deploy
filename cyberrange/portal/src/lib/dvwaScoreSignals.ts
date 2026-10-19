const HEX32 = /^[0-9a-fA-F]{32}$/
const PLACEHOLDER = /<session_id>|<admin_hash_here>/i

export type BrowserMilestone = 1 | 2 | 3 | 4

export function browserScoreLabel(milestone: BrowserMilestone): string {
  if (milestone === 4) return 'browser:xss-m4'
  return `browser:sqli-m${milestone}`
}

/** Value of the DVWA `id` field from the query string or a urlencoded body.
 *  URLSearchParams keeps a second `=` inside the value. `split('=')` would drop it.
 *  It also decodes `%XX` once and turns `+` into a space. Do not decode again.
 */
export function idValue(search: string, requestBody: string): string {
  const from = (s: string) => {
    const q = s.startsWith('?') ? s.slice(1) : s
    return new URLSearchParams(q).get('id') ?? ''
  }
  return from(search) || from(requestBody)
}

function nameValue(search: string, requestBody: string): string {
  const from = (s: string) => {
    const q = s.startsWith('?') ? s.slice(1) : s
    return new URLSearchParams(q).get('name') ?? ''
  }
  return from(search) || from(requestBody)
}

function cells(html: string): string[] {
  const out: string[] = []
  const re = /(?:First name:|Surname:)\s*([^<]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.push((m[1] || '').trim())
  return out
}

export function detectBrowserMilestone(input: {
  path: string
  search: string
  method: string
  requestBody: string
  responseText: string
}): BrowserMilestone | null {
  const path = input.path.toLowerCase()

  if (path.includes('/vulnerabilities/xss_r')) {
    const name = nameValue(input.search, input.requestBody)
    if (!name || PLACEHOLDER.test(name)) return null
    if (!/<script/i.test(name)) return null
    if (!/Hello <script/i.test(input.responseText)) return null
    return 4
  }

  if (!path.includes('/vulnerabilities/sqli')) return null
  const id = idValue(input.search, input.requestBody)
  if (!id || PLACEHOLDER.test(id)) return null
  const body = input.responseText
  const values = cells(body)

  const unionUsers = /union\s+select/i.test(id) && /from\s+users/i.test(id)
  if (unionUsers && values.some((v) => HEX32.test(v))) return 3

  const unionMeta = /union\s+select/i.test(id) && /(information_schema|database\s*\()/i.test(id)
  const metaHit = values.some((v) => /information_schema|^dvwa$/i.test(v))
  if (unionMeta && metaHit) return 2

  const quote = id.includes("'")
  const orPayload = /or\s+['"]?1['"]?\s*=\s*['"]?1/i.test(id)
  const sqlError = /you have an error in your sql syntax|syntax error/i.test(body)
  const firstNameCount = (body.match(/First name:/gi) || []).length
  if (orPayload && firstNameCount >= 2) return 1
  if (quote && sqlError) return 1

  return null
}

/** Instructor-only codes; keep in sync with REASON_CODES_BY_SCENARIO[6] in scoring_diagnostics.py. */
export type NearMissReason =
  | 'SECURITY_NOT_LOW'
  | 'PAYLOAD_NO_ROWS'
  | 'QUOTE_NO_ERROR'
  | 'UNION_NO_METADATA'
  | 'UNION_NO_HASH'
  | 'XSS_NOT_REFLECTED'

export type NearMiss = { milestone: BrowserMilestone; reason: NearMissReason }

/** DVWA's `security` cookie (low/medium/high/impossible), lowercased, or '' when absent. */
export function dvwaSecurityLevel(cookieHeader: string): string {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === 'security') {
      return part.slice(eq + 1).trim().toLowerCase()
    }
  }
  return ''
}

/** Why an attack on this page did not score, for instructors. Call only when
 *  detectBrowserMilestone returned null for the same request.
 *  Returns null unless the input is clearly an attempt at one milestone: a plain
 *  id or name, a placeholder, or a payload shape the detector does not look for
 *  stays generic. The reason names what the response lacked, never a fix.
 */
export function browserNearMiss(input: {
  path: string
  search: string
  requestBody: string
  responseText: string
  securityLevel: string
}): NearMiss | null {
  const path = input.path.toLowerCase()
  const notLow = input.securityLevel !== '' && input.securityLevel !== 'low'

  if (path.includes('/vulnerabilities/xss_r')) {
    const name = nameValue(input.search, input.requestBody)
    if (!name || PLACEHOLDER.test(name) || !/<script/i.test(name)) return null
    if (notLow) return { milestone: 4, reason: 'SECURITY_NOT_LOW' }
    if (!/Hello <script/i.test(input.responseText)) return { milestone: 4, reason: 'XSS_NOT_REFLECTED' }
    return null
  }

  if (!path.includes('/vulnerabilities/sqli')) return null
  const id = idValue(input.search, input.requestBody)
  if (!id || PLACEHOLDER.test(id)) return null

  // Same payload tests as detectBrowserMilestone, most specific first.
  const union = /union\s+select/i.test(id)
  let attempt: NearMiss | null = null
  if (union) {
    // A UNION the detector has no rule for (e.g. another table) stays generic.
    if (/from\s+users/i.test(id)) attempt = { milestone: 3, reason: 'UNION_NO_HASH' }
    else if (/(information_schema|database\s*\()/i.test(id)) attempt = { milestone: 2, reason: 'UNION_NO_METADATA' }
  } else if (/or\s+['"]?1['"]?\s*=\s*['"]?1/i.test(id)) attempt = { milestone: 1, reason: 'PAYLOAD_NO_ROWS' }
  else if (id.includes("'")) {
    // Another tautology (`' or 'a'='a`, `' OR true#`, `' || 1#`) or a page that
    // listed several users may have worked in a way the detector doesn't
    // recognise, so only a lone quote with one row or none is a near-miss.
    const rows = (input.responseText.match(/First name:/gi) || []).length
    if (rows < 2 && !/\bor\b|\|\|/i.test(id)) attempt = { milestone: 1, reason: 'QUOTE_NO_ERROR' }
  }
  if (!attempt) return null
  return notLow ? { milestone: attempt.milestone, reason: 'SECURITY_NOT_LOW' } : attempt
}

export type ScoreNotice = { title: string; message: string }

/** Student-facing reason a detected attack did not earn points.
 *  `status` is the API status, or null when the request timed out or never got an answer.
 *  A timeout can still mean the API saved the score, so that case says "may not".
 */
export function browserScoreFailureHint(status: number | null, detail = ''): ScoreNotice {
  if (status === null) {
    return {
      title: 'Score may not have updated.',
      message:
        'Your attack worked, but the scoring service did not respond in time, so the score may not have updated. Check your score panel before repeating this step.',
    }
  }
  if (status === 409 && /scenario/i.test(detail)) {
    return {
      title: 'Score not updated.',
      message: 'Your attack worked, but your active lab is a different scenario. Start Scenario 2 to earn points for it.',
    }
  }
  if (status === 409) {
    return {
      title: 'Score not updated.',
      message:
        'Your attack worked, but your lab is not active, so it was not scored. Start Scenario 2 again from the portal, then repeat this step.',
    }
  }
  return {
    title: 'Score not updated.',
    message: `Your attack worked, but the scoring service rejected the request (HTTP ${status}). Repeating the step will not fix this, so tell your instructor.`,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Put a visible notice at the top of a DVWA page. Text is escaped; the page keeps its own markup. */
export function injectScoreNotice(html: string, notice: ScoreNotice): string {
  const banner =
    '<div role="alert" data-cr-score-notice style="margin:8px;padding:10px 12px;border:1px solid #b45309;' +
    'border-radius:6px;background:#fffbeb;color:#78350f;font:14px/1.4 system-ui,sans-serif">' +
    `<strong>${escapeHtml(notice.title)}</strong> ${escapeHtml(notice.message)}</div>`
  const body = /<body\b[^>]*>/i.exec(html)
  if (!body) return banner + html
  const at = body.index + body[0].length
  return html.slice(0, at) + banner + html.slice(at)
}
