/**
 * @jest-environment node
 */

import { admin } from "@/lib/api"
import {
  AUDIT_CSV_HEADERS,
  AUDIT_CSV_MAX_ROWS,
  auditCsvFilename,
  auditEventToCsvRow,
  buildAuditCsv,
  csvField,
  fetchAuditEventsForCsv,
} from "./auditCsv"
import type { AuditEvent } from "@/lib/api"

jest.mock("@/lib/api", () => ({
  admin: { listAuditLog: jest.fn() },
}))

const listAuditLog = admin.listAuditLog as jest.Mock

const sample: AuditEvent = {
  id: 2,
  event_type: "ADMIN_USER_ROLE_SET",
  student_id: "student2",
  pod_id: null,
  vmid: null,
  result: "OK",
  detail: "actor=admin_demo role=instructor previous=student",
  timestamp: "2026-10-15 00:58:00",
}

describe("csvField", () => {
  it("leaves plain values alone", () => {
    expect(csvField("admin_demo")).toBe("admin_demo")
  })

  it("quotes commas, quotes, and newlines", () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField("line1\nline2")).toBe('"line1\nline2"')
  })

  it("prefixes spreadsheet formula-leading cells", () => {
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvField("+cmd")).toBe("'+cmd")
    expect(csvField("-1+1")).toBe("'-1+1")
    expect(csvField("@sum")).toBe("'@sum")
  })
})

describe("auditEventToCsvRow", () => {
  it("matches the readable Audit log columns", () => {
    expect(auditEventToCsvRow(sample)).toEqual([
      "2026-10-15 00:58:00",
      "Role changed",
      "ADMIN_USER_ROLE_SET",
      "admin_demo",
      "student2",
      "",
      "OK",
      "Role: Student → Instructor",
      "actor=admin_demo role=instructor previous=student",
    ])
  })

  it("fills By and Result for lab failures with empty result", () => {
    const fail: AuditEvent = {
      id: 4,
      event_type: "PROVISION_FAILED",
      student_id: "student1",
      pod_id: 3,
      vmid: null,
      result: null,
      detail: "[Errno 110] Connection timed out",
      timestamp: "2026-10-15 01:00:00",
    }
    const row = auditEventToCsvRow(fail)
    expect(row[1]).toBe("Lab failed to start")
    expect(row[3]).toBe("System")
    expect(row[5]).toBe("3")
    expect(row[6]).toBe("Failed")
  })
})

describe("buildAuditCsv", () => {
  it("starts with a UTF-8 BOM and the header row", () => {
    const csv = buildAuditCsv([sample])
    expect(csv.startsWith("\uFEFF")).toBe(true)
    expect(csv.slice(1).split("\r\n")[0]).toBe(AUDIT_CSV_HEADERS.join(","))
    expect(csv).toContain("Role changed")
    expect(csv).toContain("admin_demo")
  })
})

describe("auditCsvFilename", () => {
  it("uses a UTC stamp", () => {
    expect(auditCsvFilename(new Date("2026-10-16T08:30:05Z"))).toBe("audit_log_20261016T083005Z.csv")
  })
})

describe("fetchAuditEventsForCsv", () => {
  beforeEach(() => {
    listAuditLog.mockReset()
  })

  it("pages until next_before_id is null", async () => {
    listAuditLog
      .mockResolvedValueOnce({
        events: [{ ...sample, id: 3 }, { ...sample, id: 2 }],
        next_before_id: 2,
        event_types: [],
      })
      .mockResolvedValueOnce({
        events: [{ ...sample, id: 1 }],
        next_before_id: null,
        event_types: [],
      })

    const { events, truncated } = await fetchAuditEventsForCsv({ eventType: "ADMIN_USER_ROLE_SET" })
    expect(truncated).toBe(false)
    expect(events.map((e) => e.id)).toEqual([3, 2, 1])
    expect(listAuditLog.mock.calls[1][0].beforeId).toBe(2)
  })

  it("stops at the hard cap and marks truncated", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ ...sample, id: 10000 - i }))
    listAuditLog.mockImplementation(async ({ beforeId }: { beforeId?: number }) => ({
      events: page.map((e, i) => ({ ...e, id: (beforeId ?? 10001) - 1 - i })),
      next_before_id: 1,
      event_types: [],
    }))

    const { events, truncated } = await fetchAuditEventsForCsv({})
    expect(truncated).toBe(true)
    expect(events).toHaveLength(AUDIT_CSV_MAX_ROWS)
  })
})
