import { formatSqliteDate, parseSqliteUtc } from "./sqliteTime"

describe("parseSqliteUtc", () => {
  it("reads a space-separated SQLite timestamp as UTC", () => {
    expect(parseSqliteUtc("2026-09-20 11:00:00")?.toISOString()).toBe("2026-09-20T11:00:00.000Z")
  })

  it("keeps fractional seconds", () => {
    expect(parseSqliteUtc("2026-09-20 11:00:00.250")?.toISOString()).toBe("2026-09-20T11:00:00.250Z")
  })

  it("passes ISO timestamps with an explicit zone through unchanged", () => {
    expect(parseSqliteUtc("2026-09-20T19:00:00+08:00")?.toISOString()).toBe("2026-09-20T11:00:00.000Z")
    expect(parseSqliteUtc("2026-09-20T11:00:00Z")?.toISOString()).toBe("2026-09-20T11:00:00.000Z")
  })

  it("returns null for missing, blank or invalid input", () => {
    expect(parseSqliteUtc(null)).toBeNull()
    expect(parseSqliteUtc(undefined)).toBeNull()
    expect(parseSqliteUtc("   ")).toBeNull()
    expect(parseSqliteUtc("not a date")).toBeNull()
  })
})

describe("formatSqliteDate", () => {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }

  it("formats a SQLite UTC timestamp in local time, not unshifted", () => {
    const expected = new Date(Date.UTC(2026, 8, 20, 11, 0, 0)).toLocaleDateString(undefined, options)
    expect(formatSqliteDate("2026-09-20 11:00:00")).toBe(expected)
  })

  it("returns '-' when missing and the raw string when unparseable", () => {
    expect(formatSqliteDate(null)).toBe("-")
    expect(formatSqliteDate("")).toBe("-")
    expect(formatSqliteDate("garbage")).toBe("garbage")
  })
})
