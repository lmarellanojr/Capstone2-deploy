// Remembers, per user in this browser, that the first-run lab walkthrough was
// shown, so it auto-starts on a user's first lab launch only. Keyed by user so
// a shared lab machine still shows it to each new student. Like bigPictureSeen
// it's a convenience: if storage is blocked every accessor falls back to "not
// seen" (read) or a no-op (write), and the tour simply shows again.

const key = (userId: string) => `cr.labTourSeen.${userId}`

export function hasSeenLabTour(userId: string): boolean {
  try {
    return window.localStorage.getItem(key(userId)) === "1"
  } catch {
    return false
  }
}

export function markLabTourSeen(userId: string): void {
  try {
    window.localStorage.setItem(key(userId), "1")
  } catch {
    // Storage unavailable — the walkthrough will show again next launch.
  }
}
