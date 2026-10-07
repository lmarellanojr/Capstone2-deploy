'use client'

import React, { useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'

interface TerminalSideCueProps {
  taskId: number
  cueText?: string
  variant?: 'info' | 'warning'
}

export function TerminalSideCue({ taskId, cueText, variant }: TerminalSideCueProps) {
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<number>>(new Set())

  // Reset or check dismissal state per task
  const isDismissed = dismissedTaskIds.has(taskId)

  if (!cueText || isDismissed) {
    return null
  }

  const handleDismiss = () => {
    setDismissedTaskIds((prev) => new Set(prev).add(taskId))
  }

  const isWarning = variant === 'warning' || cueText.startsWith('⚠')

  return (
    <div
      className="absolute top-12 right-4 z-20 max-w-sm pointer-events-none transition-opacity duration-200 motion-reduce:transition-none"
      role="complementary"
      aria-label="Lab tip"
    >
      <div
        className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl backdrop-blur-sm border shadow-overlay text-xs ${
          isWarning
            ? 'bg-amber-50/95 border-amber-300 text-amber-950'
            : 'bg-secondary/95 border-border text-text-main'
        }`}
      >
        {isWarning ? (
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <Info size={16} className="text-brand shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <p className="flex-1 leading-relaxed select-text font-normal">
          {cueText}
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss hint"
          title="Dismiss hint"
          className="p-1 -mr-1 -mt-1 text-text-muted hover:text-text-main rounded hover:bg-muted transition focus-ring"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
