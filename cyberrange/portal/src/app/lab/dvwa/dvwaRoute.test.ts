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
})
