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
