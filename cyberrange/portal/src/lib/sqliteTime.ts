/**
 * Parses SQLite's space-formatted UTC timestamps ('YYYY-MM-DD HH:MM:SS')
 * and ISO-8601 timestamps that already include `Z` or a numeric UTC offset.
 * Returns null for missing, blank, or invalid input.
 *
 * Source: INSTRUCTOR_API_HANDOFF.md §3.6 — `new Date()` on the raw SQLite
 * string reads it as local time, shifting every timestamp by the UTC offset.
 */
export function parseSqliteUtc(utcStr: string | null | undefined): Date | null {
  const value = utcStr?.trim();
  if (!value) return null;

  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalized = sqliteUtcPattern.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats a backend timestamp in the viewer's local time, e.g. "Sep 20, 07:00 PM".
 * Returns "-" when missing and the raw string when it cannot be parsed.
 */
export function formatSqliteDate(dateStr?: string | null): string {
  if (!dateStr) return "-";
  const d = parseSqliteUtc(dateStr);
  return d
    ? d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : dateStr;
}
