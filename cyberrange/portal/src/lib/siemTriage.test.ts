import fs from "fs"
import path from "path"
import { categorize, EXPECTED_RULES, triageAlerts } from "./siemTriage"
import type { SiemAlert } from "@/lib/api"

function alert(rule_id: string, timestamp: string, agent_name = "pod-alice-meta", rule_level = 5): SiemAlert {
  return { timestamp, agent_id: "012", agent_name, rule_id, rule_description: `rule ${rule_id}`, rule_level }
}

describe("categorize", () => {
  it.each([
    ["5710", "09", "expected"],
    ["5710", "01", "activity"], // SSH activity, but not what Scenario 1 is scored on
    ["5402", null, "activity"],
    ["550", null, "activity"],
    ["31103", null, "activity"],
    ["19007", "09", "background"],
    ["510", null, "background"],
    ["503", null, "background"],
    ["2904", null, "background"],
    ["80790", null, "other"],
  ])("rule %s in scenario %s -> %s", (rule, scenario, expected) => {
    expect(categorize(rule, scenario).category).toBe(expected)
  })

  it("normalizes the scenario id (9 / '9' / '09')", () => {
    expect(categorize("5710", 9).category).toBe("expected")
    expect(categorize("5710", "9").category).toBe("expected")
  })
})

describe("triageAlerts", () => {
  // Shape of a real fresh lab: a burst of start-up scans plus one student action.
  const alerts = [
    ...Array.from({ length: 102 }, (_, i) => alert("19007", `2026-09-30T03:37:${String(i % 60).padStart(2, "0")}.000+0000`, "pod-alice-meta", 3)),
    ...Array.from({ length: 48 }, (_, i) => alert("510", `2026-09-30T03:37:${String(i).padStart(2, "0")}.500+0000`, "pod-alice-dvwa", 7)),
    alert("5710", "2026-09-30T03:45:10.000+0000"),
    alert("5710", "2026-09-30T03:45:02.000+0000"),
  ]

  it("puts the scenario's rule first and counts the background separately", () => {
    const { groups, counts } = triageAlerts(alerts, "09")
    expect(counts).toEqual({ expected: 2, activity: 0, other: 0, background: 150 })
    expect(groups.map((g) => [g.rule_id, g.count])).toEqual([["5710", 2], ["19007", 102], ["510", 48]])
  })

  it("keeps first/last seen, max level, agents and newest-first occurrences per rule", () => {
    const [ssh, , rootcheck] = triageAlerts(alerts, "09").groups
    expect(ssh.first).toBe("2026-09-30T03:45:02.000+0000")
    expect(ssh.last).toBe("2026-09-30T03:45:10.000+0000")
    expect(ssh.alerts[0].timestamp).toBe("2026-09-30T03:45:10.000+0000")
    expect(rootcheck.level).toBe(7)
    expect(rootcheck.agents).toEqual(["pod-alice-dvwa"])
  })
})

describe("EXPECTED_RULES matches the backend scoring map", () => {
  it("equals the live-catalog entries of DETECTION_RULES in wazuh_rule_map.py", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "src", "provisioning", "wazuh_rule_map.py"),
      "utf8"
    )
    const live: string[] = (src.match(/LIVE_CATALOG_SCENARIOS[^=]*=\s*\(([^)]*)\)/)?.[1] ?? "").match(/\d+/g) ?? []
    const backend: Record<string, string[]> = {}
    const entry = /\((\d+),\s*\d+\):\s*\{\s*"role":\s*"\w+",\s*"rule_id":\s*"(\w+)"\s*\}/g
    let m: RegExpExecArray | null
    while ((m = entry.exec(src)) !== null) {
      const sid = m[1].padStart(2, "0")
      if (!live.includes(sid)) continue
      ;(backend[sid] ??= []).push(m[2])
    }
    expect(live.length).toBeGreaterThan(0)
    expect(backend).toEqual(EXPECTED_RULES)
  })
})
