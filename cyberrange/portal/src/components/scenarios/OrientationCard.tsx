'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowRight, Compass, Sparkles } from 'lucide-react'

export function OrientationCard() {
  return (
    <div
      data-testid="orientation-card"
      className="card-surface card-interactive p-6 flex flex-col justify-between border-brand/30 bg-gradient-to-br from-secondary via-secondary to-brand/5 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 p-3 pointer-events-none opacity-10 text-brand">
        <Compass size={96} aria-hidden="true" />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-brand text-white">
            <Sparkles size={13} aria-hidden="true" />
            Start Here
          </span>
          <span className="text-xs text-text-muted font-medium">
            Orientation · 5 min
          </span>
        </div>

        <h2 className="text-xl font-bold text-text-main mb-2">
          Scenario 0 — Lab Orientation
        </h2>
        <p className="text-sm text-text-secondary leading-relaxed mb-4">
          Learn how the two-pane lab environment works, how milestones are auto-scored,
          terminal prompts, and how to capture the final flag before launching your first lab.
        </p>
      </div>

      <div className="pt-2 border-t border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-brand">
          No lab pod required
        </span>
        <Link
          href="/scenario/orientation"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition shadow-sm focus-ring"
        >
          <span>Start Orientation</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
