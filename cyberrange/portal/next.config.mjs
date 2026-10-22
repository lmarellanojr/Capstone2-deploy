/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // next dev -H 0.0.0.0 turns slash redirects into http://0.0.0.0:3000/... (ERR_ADDRESS_INVALID).
  skipTrailingSlashRedirect: true,
  // Do not put NEXTAUTH_URL in `env:` — that inlines it at build time and
  // Chapter 07 cannot flip HTTPS by editing .env.local + restarting the unit.
  // CR-10 / #312 interim: disable Image Optimization API until next is upgraded.
  // Local next/image assets under /public still render; optimizer advisories are deferred.
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
