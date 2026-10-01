// Remembers, per browser, which scenarios' Big Picture a student has already
// been shown, so the welcome auto-opens the first time only. It's a
// convenience, not a record: storage can be blocked (private windows, strict
// settings), and every accessor then falls back to "not seen" silently.

const key = (scenarioId: string) => `cr.bigPictureSeen.${scenarioId}`

export function hasSeenBigPicture(scenarioId: string): boolean {
  try {
    return window.localStorage.getItem(key(scenarioId)) === "1"
  } catch {
    return false
  }
}

export function markBigPictureSeen(scenarioId: string): void {
  try {
    window.localStorage.setItem(key(scenarioId), "1")
  } catch {
    // Storage unavailable — the welcome will simply show again next visit.
  }
}
