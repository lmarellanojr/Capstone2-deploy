'use client'

import React, { useState, useMemo } from 'react'
import { Clock, ExternalLink, ShieldCheck } from 'lucide-react'
import { Pod } from '@/lib/api'
import { Scenario } from '@/hooks/useScenarios'
import { Button } from '@/components/ui/Button'
import { TerminalSideCue } from '@/components/scenario/TerminalSideCue'
import { DVWA_PREFIX } from '@/lib/dvwaProxy'
import { podIps } from '@/lib/podIps'

export const DVWA_LOGIN_URL = `${DVWA_PREFIX}/login.php`

export const DVWA_MODULE_NAV = [
  { label: 'Home', path: `${DVWA_PREFIX}/index.php` },
  { label: 'SQL Injection', path: `${DVWA_PREFIX}/vulnerabilities/sqli/` },
  { label: 'XSS (Reflected)', path: `${DVWA_PREFIX}/vulnerabilities/xss_r/` },
  { label: 'DVWA Security', path: `${DVWA_PREFIX}/security.php` },
  { label: 'Login', path: DVWA_LOGIN_URL },
] as const

export interface DvwaViewProps {
  pod: Pod
  scenario: Scenario
  currentTaskId?: number
  currentTaskCue?: string
  expired?: boolean
  ttlGrace?: boolean
  canRestart?: boolean
  onRestart?: () => void
}

export function DvwaView({
  pod,
  scenario,
  currentTaskId,
  currentTaskCue,
  expired = false,
  ttlGrace = false,
  canRestart = false,
  onRestart,
}: DvwaViewProps) {
  const [navState, setNavState] = useState<{ path: string; nonce: number }>({
    path: `${DVWA_PREFIX}/index.php`,
    nonce: 0,
  })

  const ips = useMemo(() => {
    try {
      return podIps(pod.pod_id)
    } catch {
      return null
    }
  }, [pod.pod_id])

  const targetIp = ips?.dvwa
  const isPodActive = pod.status === 'ACTIVE'

  const handleNavigate = (path: string) => {
    setNavState((prev) => ({ path, nonce: prev.nonce + 1 }))
  }

  return (
    <div
      data-testid="lab-dvwa-container"
      className="flex flex-col flex-1 w-full min-w-0 min-h-0 h-full relative"
    >
      {ttlGrace && !expired && (
        <div
          role="status"
          className="absolute top-0 left-0 right-0 z-20 px-3 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900 rounded-t-xl"
        >
          Time limit reached. This lab will close within about 10 minutes. You can keep working until it stops.
        </div>
      )}

      {expired && (
        <div className="absolute inset-0 z-10 bg-white/95 flex items-center justify-center rounded-xl">
          <div className="text-center max-w-sm" role="status">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-warning">
              <Clock size={28} aria-hidden="true" />
            </div>
            <h3 className="text-2xl font-bold mb-2">Session shutting down</h3>
            <p className="text-text-secondary mb-6">
              This lab session is shutting down. Your progress is saved.
            </p>
            <div className="flex gap-3 justify-center">
              {canRestart && onRestart && (
                <Button variant="primary" onClick={onRestart}>
                  Start new session
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => (window.location.href = '/dashboard')}
              >
                Back to dashboard
              </Button>
            </div>
          </div>
        </div>
      )}

      <div
        className="flex flex-col flex-1 w-full min-w-0 min-h-0 h-full"
        style={{ visibility: expired ? 'hidden' : 'visible' }}
      >
        {/* Pane Chrome Header */}
        <div
          data-testid="lab-dvwa-card-header"
          className="mb-2 flex flex-wrap items-center justify-between gap-2 bg-secondary border border-border rounded-xl px-4 py-2.5 shrink-0 shadow-card"
        >
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-text-main truncate">
                {scenario.name} (DVWA)
              </h2>
              {targetIp && (
                <span className="text-xs text-text-muted font-mono block">
                  Target: {targetIp}
                </span>
              )}
            </div>
            {/* Security: Low Indicator */}
            <div
              role="status"
              aria-label="DVWA Security Level"
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200"
            >
              <ShieldCheck size={13} className="text-emerald-600 shrink-0" aria-hidden="true" />
              <span>Security: Low</span>
            </div>
            {!isPodActive && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                {pod.status}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!isPodActive}
              onClick={() => window.open(navState.path, '_blank', 'noopener,noreferrer')}
            >
              <span>Open in new tab</span>
              <ExternalLink size={14} className="ml-1.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Main DVWA Browser Window */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden border border-border bg-white shadow-card relative">
          {/* Grey module navigation strip */}
          <nav
            aria-label="DVWA Modules"
            data-testid="dvwa-module-nav"
            className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/80 px-3 py-2 shrink-0"
          >
            {DVWA_MODULE_NAV.map((item) => {
              const isActive = navState.path === item.path
              return (
                <button
                  key={item.label}
                  type="button"
                  disabled={!isPodActive}
                  onClick={() => handleNavigate(item.path)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus-ring ${
                    isActive
                      ? 'bg-secondary text-brand font-semibold shadow-sm border border-border'
                      : 'border border-border bg-secondary/60 text-text-main hover:bg-secondary hover:border-brand/40 hover:text-brand'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>

          {/* Floating Side Cue for current task */}
          {currentTaskId && currentTaskCue && isPodActive && (
            <TerminalSideCue taskId={currentTaskId} cueText={currentTaskCue} />
          )}

          {/* Sandboxed DVWA Frame */}
          <div className="flex-1 min-h-0 bg-white relative overflow-hidden">
            {isPodActive && !expired ? (
              <iframe
                key={navState.nonce}
                src={navState.path}
                title="DVWA - Damn Vulnerable Web Application"
                className="w-full h-full border-0 bg-white"
              />
            ) : !expired ? (
              <div
                data-testid="dvwa-inactive-status"
                className="flex items-center justify-center h-full text-text-muted text-sm"
                role="status"
              >
                Lab environment is {pod.status.toLowerCase()}...
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
