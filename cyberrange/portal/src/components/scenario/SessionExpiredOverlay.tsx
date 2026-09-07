'use client'

import { Button } from '@/components/ui'

export function SessionExpiredOverlay({
  ttlHours,
  onRestart,
  onDashboard,
}: {
  ttlHours: number | null
  onRestart: () => void
  onDashboard: () => void
}) {
  const body =
    typeof ttlHours === 'number'
      ? `Your ${ttlHours}-hour lab time limit ended and this session was stopped. Your progress is saved.`
      : 'Your lab time limit ended and this session was stopped. Your progress is saved.'

  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">⏱</div>
        <h3 className="text-2xl font-bold mb-2">Session Expired</h3>
        <p className="text-text-secondary mb-6">{body}</p>
        <div className="flex gap-3 justify-center">
          <Button variant="primary" onClick={onRestart}>
            Start New Session
          </Button>
          <Button variant="secondary" onClick={onDashboard}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
