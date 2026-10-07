'use client'

import React from 'react'
import { CheckCircle2, Info } from 'lucide-react'
import { Milestone } from '@/hooks/useScenarios'
import { FlagSubmission } from '@/components/scenario/FlagSubmission'

const DEFAULT_PENDING_COPY = 'The range is watching your session — this step scores automatically.'

// Scenarios whose auto-scoring reads one specific host's state say so, so the
// student knows where the work has to happen for the tick to appear.
const PENDING_COPY: Record<string, React.ReactNode> = {
  '11': (
    <>
      Scoring reads the <strong>meta</strong> host state — this ticks automatically a few
      seconds after the step works.
    </>
  ),
}

interface TaskScoreStatusProps {
  milestone: Milestone
  completed: boolean
  isFlag: boolean
  scenarioId: string
  onFlagPass?: () => void
  disabled?: boolean
}

export function TaskScoreStatus({
  milestone,
  completed,
  isFlag,
  scenarioId,
  onFlagPass = () => {},
  disabled = false,
}: TaskScoreStatusProps) {
  if (completed) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium"
      >
        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" aria-hidden="true" />
        <span>✓ Milestone scored · +{milestone.points} pts</span>
      </div>
    )
  }

  if (disabled) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/60 text-text-muted text-xs"
      >
        <Info size={16} className="text-text-muted shrink-0" aria-hidden="true" />
        <span>Lab session expired. Scoring is unavailable.</span>
      </div>
    )
  }

  if (isFlag) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-text-muted">
          This is the one step you submit yourself.
        </p>
        <FlagSubmission
          scenarioId={scenarioId}
          milestoneId={milestone.id}
          placeholder={scenarioId === '01' ? 'e.g. student' : 'e.g. brave-otter-7421'}
          onPass={onFlagPass}
        />
      </div>
    )
  }

  return (
    <div
      role="status"
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/60 text-text-muted text-xs"
    >
      <Info size={16} className="text-text-muted shrink-0" aria-hidden="true" />
      <span>{PENDING_COPY[scenarioId] ?? DEFAULT_PENDING_COPY}</span>
    </div>
  )
}
