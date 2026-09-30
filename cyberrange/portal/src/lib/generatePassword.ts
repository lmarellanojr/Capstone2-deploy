// Temporary passwords an Admin can read out or paste to a student.
// Ambiguous characters (0/O, 1/l/I) are left out; at least one character of
// each class is guaranteed so common Keycloak password policies accept it.
// Uses crypto.getRandomValues — never Math.random for credentials.

const LOWER = "abcdefghijkmnpqrstuvwxyz"
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const DIGIT = "23456789"
const SYMBOL = "!@#$%*-_=+"
const ALL = LOWER + UPPER + DIGIT + SYMBOL

/** `rand(n)` returns an unbiased integer in [0, n). Injectable for tests. */
export function generatePassword(length = 14, rand: (n: number) => number = secureRandomInt): string {
  const size = Math.max(length, 8)
  const chars = [LOWER, UPPER, DIGIT, SYMBOL].map((set) => set[rand(set.length)])
  while (chars.length < size) chars.push(ALL[rand(ALL.length)])
  // Fisher–Yates so the guaranteed characters aren't always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

// Rejection sampling avoids modulo bias.
export function secureRandomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  let v: number
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return v % max
}
