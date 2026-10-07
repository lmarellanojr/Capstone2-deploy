'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, FileDown, Info, Keyboard, ShieldAlert } from 'lucide-react'
import { Pod } from '@/lib/api'
import { Milestone, Scenario } from '@/hooks/useScenarios'
import { GuideView } from '@/components/scenario/GuideView'
import { TaskScoreStatus } from '@/components/scenario/TaskScoreStatus'
import { Button } from '@/components/ui/Button'

interface ExercisePanelProps {
  pod: Pod
  scenario: Scenario
  currentTask: Milestone
  taskIndex: number
  totalTasks: number
  completed: boolean
  isFlag: boolean
  lockedReview: boolean
  verifying: boolean
  milestonesLoading: boolean
  expired?: boolean
  onVerify: (milestoneId: number) => Promise<void>
  onFlagPass: (milestoneId: number) => void
  onRequestReview: (milestoneId: number, mode: 'new' | 'retry') => void
  latestReviewStatus?: string
  hasLatestReview?: boolean
  onOpenScoringInfo?: () => void
}

export function ExercisePanel({
  pod,
  scenario,
  currentTask,
  taskIndex,
  totalTasks,
  completed,
  isFlag,
  lockedReview,
  verifying,
  milestonesLoading,
  expired = false,
  onVerify,
  onFlagPass,
  onRequestReview,
  latestReviewStatus,
  hasLatestReview,
  onOpenScoringInfo,
}: ExercisePanelProps) {
  const [guideOpen, setGuideOpen] = useState(false)

  // Fallback to description if concise goal string is not defined
  const goalText = currentTask.goal || currentTask.description

  const renderInstructorReview = () => {
    if (expired) {
      return (
        <p className="text-xs text-text-muted">
          Lab session expired — instructor review unavailable.
        </p>
      )
    }
    if (hasLatestReview && (latestReviewStatus === 'PENDING' || !latestReviewStatus)) {
      return (
        <p className="text-xs text-text-muted">
          Instructor review requested — waiting for a reply.
        </p>
      )
    }
    if (latestReviewStatus === 'RETRY') {
      return (
        <button
          type="button"
          onClick={() => onRequestReview(currentTask.id, 'retry')}
          className="text-xs font-semibold text-brand hover:underline rounded focus-ring"
        >
          Your instructor asked for more detail — send again
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => onRequestReview(currentTask.id, 'new')}
        className="text-xs font-semibold text-brand hover:underline rounded focus-ring"
      >
        Ask an instructor to check this task
      </button>
    )
  }

  return (
    <div
      data-testid="lab-exercise-panel"
      className="card-surface p-4 sm:p-5 flex flex-col h-full min-h-0 overflow-hidden"
    >
      {/* Exercise Brief & Header */}
      <div className="border-b border-border pb-3 mb-3 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
            Task {taskIndex + 1} of {totalTasks}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-text-main border border-border">
            {currentTask.points} pts
          </span>
        </div>
        <h2 className="text-lg font-bold text-text-main leading-snug">
          {currentTask.name}
        </h2>
      </div>

      {/* Scrollable exercise instructions & status */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {/* Goal-oriented instructions */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Instructions
          </div>
          <div className="p-3 rounded-xl bg-muted/50 border border-border space-y-2 text-sm text-text-main">
            <p className="font-medium leading-relaxed">
              {goalText}
            </p>
            {currentTask.goal && currentTask.description && (
              <p className="text-xs text-text-muted leading-relaxed">
                {currentTask.description}
              </p>
            )}
          </div>
        </div>

        {/* Task Auto-Score or Flag Status */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Status
            </span>
            {onOpenScoringInfo && (
              <button
                type="button"
                onClick={onOpenScoringInfo}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-brand rounded focus-ring"
              >
                <Info size={12} aria-hidden="true" />
                How scoring works
              </button>
            )}
          </div>
          <TaskScoreStatus
            milestone={currentTask}
            completed={completed}
            isFlag={isFlag}
            scenarioId={scenario.id}
            onFlagPass={() => onFlagPass(currentTask.id)}
            disabled={expired}
          />
        </div>

        {/* Manual check / Instructor review (when not complete and not flag) */}
        {!completed && !isFlag && (
          <div className="pt-1">
            {lockedReview ? (
              <div
                className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs"
                role="status"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert size={16} className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-amber-900">
                      Automated check couldn&apos;t verify this task
                    </p>
                    <p className="mt-0.5 text-amber-800">
                      Your Manual Check has been used. An instructor needs to review your
                      work to award the points.
                    </p>
                    <div className="mt-2">{renderInstructorReview()}</div>
                  </div>
                </div>
              </div>
            ) : (
              <details className="text-xs">
                <summary className="text-text-muted cursor-pointer select-none hover:text-text-main rounded w-fit focus-ring">
                  Not detected yet?
                </summary>
                <div className="mt-2 space-y-2 pl-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!expired) onVerify(currentTask.id)
                    }}
                    disabled={expired || verifying || milestonesLoading}
                    className="w-full text-xs"
                  >
                    {verifying ? 'Checking…' : 'Manual Check'}
                  </Button>
                  {expired ? (
                    <p className="text-[11px] text-danger leading-relaxed">
                      Lab session expired. Start a new session to verify your work.
                    </p>
                  ) : (
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      You get one Manual Check. If it can&apos;t verify your work, the task moves to instructor review.
                    </p>
                  )}
                  <div>{renderInstructorReview()}</div>
                </div>
              </details>
            )}
          </div>
        )}

        {/* Type it yourself hint */}
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-chip/60 border border-border text-xs text-text-muted">
          <Keyboard size={15} className="text-text-faint shrink-0" aria-hidden="true" />
          <span>Type the commands yourself; Copy is in the Guide below if you get stuck.</span>
        </div>

        {/* Collapsible Guide View */}
        <div className="border border-border rounded-xl overflow-hidden bg-secondary">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/60 border-b border-border">
            <button
              type="button"
              onClick={() => setGuideOpen((prev) => !prev)}
              aria-expanded={guideOpen}
              className="flex items-center gap-2 text-xs font-bold text-text-main hover:text-brand transition focus-ring"
            >
              <span>Walkthrough Guide</span>
              {guideOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              title="Export the guide as a PDF"
              aria-label="Export guide as PDF"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-brand rounded transition focus-ring"
            >
              <FileDown size={13} aria-hidden="true" />
              PDF
            </button>
          </div>

          {/* CRITICAL: Keep GuideView mounted so #guide-print-root portal stays active! */}
          <div className={guideOpen ? 'p-3 block max-h-96 overflow-y-auto' : 'hidden'}>
            <GuideView pod={pod} scenario={scenario} />
          </div>
        </div>
      </div>
    </div>
  )
}
