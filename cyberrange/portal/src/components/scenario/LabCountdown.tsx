'use client'
import { useEffect, useState } from 'react'
import { formatRemaining, remainingNow, remainingTone } from '@/lib/labTtl'

export function LabCountdown({
  remainingSeconds,
  fetchedAtMs,
}: {
  remainingSeconds: number
  fetchedAtMs: number
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = remainingNow(remainingSeconds, fetchedAtMs, now)
  const tone = remainingTone(left)
  const cls =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-text-muted'
  return (
    <span className={`text-xs font-semibold tabular-nums ${cls}`} aria-live="polite">
      Time left {formatRemaining(left)}
    </span>
  )
}
