'use client'

import { Clock } from 'lucide-react'
import { Button } from '@/components/ui'

export function SessionExpiredOverlay({
  ttlMinutes,
  onRestart,
  onDashboard,
}: {
  ttlMinutes: number | null
  onRestart: () => void
  onDashboard: () => void
}) {
  const body =
    typeof ttlMinutes === 'number'
      ? `Your ${ttlMinutes}-minute lab time limit ended and this session was stopped. Your progress is saved.`
      : 'Your lab time limit ended and this session was stopped. Your progress is saved.'

  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="card-surface text-center max-w-md px-8 py-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-warning">
          <Clock size={28} aria-hidden="true" />
        </div>
        <h3 className="text-2xl font-bold mb-2">Session expired</h3>
        <p className="text-text-secondary mb-6">{body}</p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Button variant="primary" onClick={onRestart}>
            Start new session
          </Button>
          <Button variant="secondary" onClick={onDashboard}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
