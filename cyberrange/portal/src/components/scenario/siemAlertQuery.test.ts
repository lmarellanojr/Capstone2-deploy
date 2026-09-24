import type { SiemAlert } from "@/lib/api"
import {
  describeFilters,
  emptyAlertsCopy,
  filterAlerts,
  filteredEmptyCopy,
  filterOptions,
  hasActiveFilters,
  NO_FILTERS,
  POLL_MS,
  severityBand,
} from "./siemAlertQuery"

function alert(p: Partial<SiemAlert>): SiemAlert {
  return {
    timestamp: "2026-09-25T10:00:00.000+0800",
    agent_id: "001",
    agent_name: "pod-alice-meta",
    rule_id: "5710",
    rule_description: "sshd: Attempt to login using a non-existent user",
    rule_level: 5,
    ...p,
  } as SiemAlert
}

const rows: SiemAlert[] = [
  alert({ rule_id: "5710", rule_level: 5, agent_name: "pod-alice-meta" }),
  alert({ rule_id: "5710", rule_level: 5, agent_name: "pod-alice-dvwa" }),
  alert({ rule_id: "19007", rule_level: 7, agent_name: "pod-alice-meta", rule_description: "CIS check failed" }),
  alert({ rule_id: "510", rule_level: 3, agent_name: "pod-alice-dvwa", rule_description: "Rootcheck" }),
]

describe("SIEM-POLL poll interval", () => {
  it("polls within the 10–15s near-real-time window", () => {
    expect(POLL_MS).toBeGreaterThanOrEqual(10_000)
    expect(POLL_MS).toBeLessThanOrEqual(15_000)
  })
})

describe("severityBand", () => {
  it("matches the Lvl column colour thresholds", () => {
    expect(severityBand(12)).toBe("high")
    expect(severityBand(7)).toBe("high")
    expect(severityBand(6)).toBe("medium")
    expect(severityBand(5)).toBe("medium")
    expect(severityBand(4)).toBe("low")
    expect(severityBand(0)).toBe("low")
  })
})

describe("filterAlerts", () => {
  it("returns every row when no filter is active", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
    expect(filterAlerts(rows, NO_FILTERS)).toBe(rows)
  })

  it("filters on each dimension alone", () => {
    expect(filterAlerts(rows, { ...NO_FILTERS, ruleId: "5710" })).toHaveLength(2)
    expect(filterAlerts(rows, { ...NO_FILTERS, agent: "pod-alice-dvwa" })).toHaveLength(2)
    expect(filterAlerts(rows, { ...NO_FILTERS, severity: "high" }).map((a) => a.rule_id)).toEqual(["19007"])
  })

  it("combines dimensions with AND", () => {
    const f = { ruleId: "5710", agent: "pod-alice-meta", severity: "medium" as const }
    expect(filterAlerts(rows, f)).toHaveLength(1)
    expect(filterAlerts(rows, { ...f, severity: "high" })).toHaveLength(0)
  })
})

describe("filterOptions", () => {
  it("lists distinct rules (numeric order) and agents", () => {
    const opts = filterOptions(rows, NO_FILTERS)
    expect(opts.rules.map((r) => r.id)).toEqual(["510", "5710", "19007"])
    expect(opts.agents).toEqual(["pod-alice-dvwa", "pod-alice-meta"])
  })

  it("keeps a selected value that is no longer in the fetched rows", () => {
    const opts = filterOptions(rows, { ruleId: "5503", agent: "pod-alice-kali", severity: "" })
    expect(opts.rules.map((r) => r.id)).toContain("5503")
    expect(opts.agents).toContain("pod-alice-kali")
  })
})

describe("empty-state copy", () => {
  it("distinguishes 'no alerts fetched' from 'filters hide everything'", () => {
    expect(emptyAlertsCopy(false)).toMatch(/No alerts yet/)
    expect(emptyAlertsCopy(true)).toMatch(/No rule 5710/)
    const f = { ruleId: "510", agent: "pod-alice-meta", severity: "high" as const }
    expect(describeFilters(f)).toBe("rule 510, agent pod-alice-meta, severity High (7+)")
    expect(filteredEmptyCopy(f, 4)).toBe(
      "No alerts match rule 510, agent pod-alice-meta, severity High (7+). 4 alerts hidden by filters."
    )
    expect(filteredEmptyCopy({ ...NO_FILTERS, severity: "low" }, 1)).toMatch(/1 alert hidden/)
  })
})
