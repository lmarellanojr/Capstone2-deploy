'use client'

import React from 'react'
import { CheckCircle2, Info } from 'lucide-react'
import { Milestone } from '@/hooks/useScenarios'
import { FlagSubmission } from '@/components/scenario/FlagSubmission'

interface TaskScoreStatusProps {
  milestone: Milestone
  completed: boolean
  isFlag: boolean
  scenarioId: string
  onFlagPass?: () => void
  disabled?: boolean
  metaFileScoring?: boolean
}

export function TaskScoreStatus({
  milestone,
  completed,
  isFlag,
  scenarioId,
  onFlagPass = () => {},
  disabled = false,
  metaFileScoring = false,
}: TaskScoreStatusProps) {
  if (milestone.unscored) {
    return <p role="status" className="rounded-lg border border-border bg-muted p-3 text-xs text-text-muted">Prep — not scored. Generate the alerts, then continue to Task 1.</p>
  }
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

  if (isFlag && !metaFileScoring && scenarioId !== '09') {
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
      <span>{metaFileScoring || scenarioId === '09' ? <>The checker reads your file on <strong>meta</strong> — this scores automatically once the file is correct.</> : 'The range is watching your session — this step scores automatically.'}</span>
    </div>
  )
}
