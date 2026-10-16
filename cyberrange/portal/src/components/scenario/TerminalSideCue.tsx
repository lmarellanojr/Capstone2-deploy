'use client'

import React, { useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'

interface TerminalSideCueProps {
  taskId: number
  cueText?: string
  variant?: 'info' | 'warning'
  /** overlay floats over the lab pane; inline sits in document flow (DVWA header strip). */
  placement?: 'overlay' | 'inline'
}

// Labels say "Lab", not "Terminal": the cue also floats over the DVWA pane.
const VARIANT_STYLES = {
  info: {
    card: 'bg-secondary border-border text-text-main',
    icon: 'text-brand',
    Icon: Info,
    label: 'Lab tip',
  },
  warning: {
    card: 'alert-warning',
    icon: 'text-warning',
    Icon: AlertTriangle,
    label: 'Lab warning',
  },
} as const

// Cues are short one-liners, so only the two inline marks they use are
// supported: `code` and **bold**. Everything else renders as plain text.
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="font-mono text-[11px] bg-muted px-1 rounded">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

export function TerminalSideCue({
  taskId,
  cueText,
  variant = 'info',
  placement = 'overlay',
}: TerminalSideCueProps) {
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<number>>(new Set())

  // Reset or check dismissal state per task
  const isDismissed = dismissedTaskIds.has(taskId)

  if (!cueText || isDismissed) {
    return null
  }

  const handleDismiss = () => {
    setDismissedTaskIds((prev) => new Set(prev).add(taskId))
  }

  // A leading ⚠ also marks a warning, so cues that don't set `variant` still
  // get the warning style.
  const resolvedVariant = variant === 'warning' || cueText.startsWith('⚠') ? 'warning' : 'info'
  const style = VARIANT_STYLES[resolvedVariant]
  const { Icon } = style

  const wrapperClass =
    placement === 'inline'
      ? 'relative shrink-0 w-full px-3 py-2 border-b border-border bg-muted/40 transition-opacity duration-200 motion-reduce:transition-none'
      : 'absolute bottom-4 right-3 left-3 sm:left-auto z-[5] sm:max-w-sm pointer-events-none transition-opacity duration-200 motion-reduce:transition-none'

  const cardClass =
    placement === 'inline'
      ? `flex items-start gap-2.5 p-2.5 rounded-lg border text-xs ${style.card}`
      : `pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border shadow-overlay text-xs ${style.card}`

  return (
    <div
      className={wrapperClass}
      role="complementary"
      aria-label={style.label}
      data-variant={resolvedVariant}
      data-placement={placement}
      data-testid="lab-side-cue"
    >
      <div className={cardClass}>
        <Icon size={16} className={`${style.icon} shrink-0 mt-0.5`} aria-hidden="true" />
        <p className="flex-1 leading-relaxed text-text-main select-text">
          {renderInline(cueText)}
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
