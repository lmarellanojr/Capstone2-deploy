import { admin, type AuditEvent } from "@/lib/api"
import {
  auditActor,
  auditEventLabel,
  auditResult,
  auditResultLabel,
  humanizeAuditFacts,
} from "@/lib/auditEvents"

/** Hard cap so a huge trail cannot hang the browser. Pages at the API max. */
export const AUDIT_CSV_PAGE = 500
export const AUDIT_CSV_MAX_ROWS = 5000

export interface AuditCsvFilters {
  eventType?: string
  eventTypes?: string[]
  result?: string
  studentId?: string
}

export interface AuditCsvFetchResult {
  events: AuditEvent[]
  truncated: boolean
}

/** Pages through GET /admin/audit-log with the same filters as the table. */
export async function fetchAuditEventsForCsv(filters: AuditCsvFilters): Promise<AuditCsvFetchResult> {
  const events: AuditEvent[] = []
  let beforeId: number | undefined

  while (true) {
    const page = await admin.listAuditLog({
      eventType: filters.eventType,
      eventTypes: filters.eventTypes,
      result: filters.result,
      studentId: filters.studentId,
      beforeId,
      limit: AUDIT_CSV_PAGE,
    })
    for (const event of page.events) {
      if (events.length >= AUDIT_CSV_MAX_ROWS) {
        return { events, truncated: true }
      }
      events.push(event)
    }
    if (page.next_before_id == null) return { events, truncated: false }
    beforeId = page.next_before_id
  }
}

export const AUDIT_CSV_HEADERS = [
  "When (UTC)",
  "Event",
  "Event code",
  "By",
  "Affected user",
  "Pod",
  "Result",
  "Details",
  "Raw detail",
] as const

/** Neutralize spreadsheet formulas, then RFC 4180-quote when needed.
 *  Same rule as csvEscape in the instructor CSV helper (not on main yet). */
export function csvField(value: string): string {
  let text = value
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function auditEventToCsvRow(event: AuditEvent): string[] {
  const { actor, facts } = auditActor(event)
  const outcome = auditResult(event)
  return [
    event.timestamp ?? "",
    auditEventLabel(event.event_type),
    event.event_type,
    actor,
    event.student_id ?? "",
    event.pod_id != null ? String(event.pod_id) : "",
    outcome ? auditResultLabel(outcome) : "",
    humanizeAuditFacts(facts),
    event.detail ?? "",
  ]
}

/** Builds a UTF-8 CSV (with BOM) matching the Audit log table, plus raw fields. */
export function buildAuditCsv(events: AuditEvent[]): string {
  const lines = [
    AUDIT_CSV_HEADERS.join(","),
    ...events.map((e) => auditEventToCsvRow(e).map(csvField).join(",")),
  ]
  // BOM helps Excel open UTF-8 correctly on Windows.
  return `\uFEFF${lines.join("\r\n")}\r\n`
}

export function auditCsvFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  return `audit_log_${stamp}.csv`
}

export function saveCsvBlob(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
