'use client'

import React, { useState } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { Pod } from '@/lib/api'
import { Scenario } from '@/hooks/useScenarios'
import { Button } from '@/components/ui/Button'
import { TerminalSideCue } from '@/components/scenario/TerminalSideCue'
import { DVWA_PREFIX } from '@/lib/dvwaProxy'

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
}

export function DvwaView({
  scenario,
  currentTaskId,
  currentTaskCue,
}: DvwaViewProps) {
  const [navState, setNavState] = useState<{ path: string; nonce: number }>({
    path: `${DVWA_PREFIX}/index.php`,
    nonce: 0,
  })

  const handleNavigate = (path: string) => {
    setNavState((prev) => ({ path, nonce: prev.nonce + 1 }))
  }

  return (
    <div
      data-testid="lab-dvwa-container"
      className="flex flex-col flex-1 w-full min-w-0 min-h-0 h-full relative"
    >
      {/* Pane Chrome Header */}
      <div
        data-testid="lab-dvwa-card-header"
        className="mb-2 flex flex-wrap items-center justify-between gap-2 bg-secondary border border-border rounded-xl px-4 py-2.5 shrink-0 shadow-card"
      >
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base sm:text-lg font-bold text-text-main truncate">
            {scenario.name} (DVWA)
          </h2>
          {/* Security: Low Indicator */}
          <div
            role="status"
            aria-label="DVWA Security Level"
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200"
          >
            <ShieldCheck size={13} className="text-emerald-600 shrink-0" aria-hidden="true" />
            <span>Security: Low</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
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
        {currentTaskId && currentTaskCue && (
          <TerminalSideCue taskId={currentTaskId} cueText={currentTaskCue} />
        )}

        {/* Sandboxed DVWA Frame */}
        <div className="flex-1 min-h-0 bg-white relative overflow-hidden">
          <iframe
            key={navState.nonce}
            src={navState.path}
            title="DVWA - Damn Vulnerable Web Application"
            className="w-full h-full border-0 bg-white"
          />
        </div>
      </div>
    </div>
  )
}
