export function remainingNow(
  remainingSeconds: number,
  fetchedAtMs: number,
  nowMs: number,
): number {
  const elapsed = Math.floor((nowMs - fetchedAtMs) / 1000)
  return Math.max(0, remainingSeconds - elapsed)
}

export function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${mm}:${ss}`
}

export function remainingTone(totalSeconds: number): 'ok' | 'warn' | 'danger' {
  if (totalSeconds <= 5 * 60) return 'danger'
  if (totalSeconds <= 15 * 60) return 'warn'
  return 'ok'
}
