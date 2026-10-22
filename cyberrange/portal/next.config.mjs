/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // next dev -H 0.0.0.0 turns slash redirects into http://0.0.0.0:3000/... (ERR_ADDRESS_INVALID).
  skipTrailingSlashRedirect: true,
  // Do not put NEXTAUTH_URL in `env:` — that inlines it at build time and
  // Chapter 07 cannot flip HTTPS by editing .env.local + restarting the unit.
  // CR-11 / #313: stop advertising the framework in responses.
  poweredByHeader: false,
  // Keep the image optimizer unreachable; all portal images are local assets.
  images: { unoptimized: true },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.cache = false
    return config
  },
  // `/` → `/dashboard` as a real HTTP 307. redirect() in the root page ran at
  // build time, so `/` was prerendered as a cached 200 carrying NEXT_REDIRECT;
  // the client router then redirected mid-hydration and threw React #310 (#219).
  async redirects() {
    return [{ source: '/', destination: '/dashboard', permanent: false }]
  },
  // CR-11 / #313: path-scoped framing + baseline hardening headers.
  // DVWA owns its complete CSP in the route/middleware. Next 15 does not append
  // a route CSP when config already set one, which would drop the XSS sandbox.
  async headers() {
    const nosniff = { key: 'X-Content-Type-Options', value: 'nosniff' }
    const referrer = {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    }
    return [
      {
        source: '/((?!lab/dvwa(?:/|$)).*)',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          nosniff,
          referrer,
        ],
      },
      {
        // Exact /lab/dvwa and descendants; no CSP here (route/middleware own it).
        source: '/lab/dvwa',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          nosniff,
          referrer,
        ],
      },
      {
        source: '/lab/dvwa/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          nosniff,
          referrer,
        ],
      },
    ]
  },
  async rewrites() {
    const apiBase = process.env.API_INTERNAL_URL || 'http://10.115.77.1:5000'
    const sshBridge = process.env.SSH_BRIDGE_URL || 'http://10.115.77.1:8765'
    return [
      { source: '/api/health', destination: `${apiBase}/health` },
      // Scoring lives on the provision API (Ampere). The old Path A :8001 sidecar is not shipped.
      { source: '/api/score/:path*', destination: `${apiBase}/score/:path*` },
      // Layer 7 / R7a: xterm.js talks to /api/ssh-websocket on the portal origin.
      // next dev has no App Router handler; proxy the upgrade to host-side bridge.py.
      { source: '/api/ssh-websocket', destination: `${sshBridge}/api/ssh-websocket` },
    ]
  },
}

export default nextConfig
