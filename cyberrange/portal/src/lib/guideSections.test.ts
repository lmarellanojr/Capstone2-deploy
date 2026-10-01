import fs from "fs"
import path from "path"
import { extractBigPicture, splitGuide } from "./guideSections"
import { SCENARIOS } from "@/hooks/useScenarios"

describe("extractBigPicture", () => {
  it("returns the section 0 body without its heading, stopping at the next ## heading", () => {
    const md = [
      "## Scenario 1 — Recon",
      "intro",
      "## 0. Before you start — the big picture",
      "",
      "You are the **attacker**.",
      "### Your network",
      "| Host | IP |",
      "## 1. The two tools you'll use",
      "Nmap…",
    ].join("\n")
    expect(extractBigPicture(md)).toBe("You are the **attacker**.\n### Your network\n| Host | IP |")
  })

  it("keeps ## lines that sit inside a code fence", () => {
    const md = [
      "## 0. Before you start — the big picture",
      "Run:",
      "```bash",
      "## not a heading, a shell comment",
      "```",
      "after the fence",
      "## 1. Next",
    ].join("\n")
    const body = extractBigPicture(md)
    expect(body).toContain("## not a heading, a shell comment")
    expect(body).toContain("after the fence")
    expect(body).not.toContain("## 1. Next")
  })

  it("runs to the end of the file when section 0 is last", () => {
    expect(extractBigPicture("## 0. Before you start — the big picture\nonly this")).toBe("only this")
  })

  it("returns null when there is no section 0 or it is empty", () => {
    expect(extractBigPicture("## 1. Something else\ntext")).toBeNull()
    expect(extractBigPicture("## 0. Before you start — the big picture\n\n## 1. Next")).toBeNull()
  })

  it("handles CRLF line endings", () => {
    expect(extractBigPicture("## 0. Before you start\r\nbody\r\n## 1. Next\r\n")).toBe("body")
  })
})

// The welcome modal is one component fed by four guides — prove every real
// scenario guide actually yields a Big Picture, so no lab opens to an empty modal.
describe("every scenario guide has a Big Picture section", () => {
  const dir = path.join(__dirname, "..", "..", "public", "scenarios")

  it.each(SCENARIOS.map((s) => [s.displayNumber, s.guideFile] as const))(
    "Scenario %i (%s)",
    (_n, guideFile) => {
      const md = fs.readFileSync(path.join(dir, guideFile), "utf8")
      const body = extractBigPicture(md)
      expect(body).not.toBeNull()
      expect(body!.length).toBeGreaterThan(80)
      // Section 1 must not leak into the welcome.
      expect(body).not.toMatch(/^## 1\./m)
    }
  )
})

describe("splitGuide", () => {
  const md = [
    "## Scenario 1 — Recon",
    "intro line",
    "## 0. Before you start — the big picture",
    "overview text",
    "## 1. The two tools you'll use",
    "### Nmap",
    "scanner",
    "## 2. How scoring works (read this)",
    "the scorer reads your history",
    "",
    "Part | Meaning",
    "--- | ---",
    "a | b",
    "---",
    "**Task 1 — Host Discovery**",
    "### Task 1 — find hosts",
    "```bash",
    "## not a heading",
    "```",
    "## 3. Common failures & fixes",
    "fixes",
  ].join("\n")

  it("removes the Big Picture from the guide", () => {
    const { guide } = splitGuide(md)
    expect(guide).not.toContain("big picture")
    expect(guide).not.toContain("overview text")
  })

  it("moves section 1 into the Tools part", () => {
    const { guide, tools } = splitGuide(md)
    expect(tools).toEqual({ heading: "The two tools you'll use", body: "### Nmap\nscanner" })
    expect(guide).not.toContain("### Nmap")
  })

  it("moves the scoring explainer out, keeping a table's --- | --- row inside it", () => {
    const { guide, scoring } = splitGuide(md)
    expect(scoring).toBe("the scorer reads your history\n\nPart | Meaning\n--- | ---\na | b")
    expect(guide).not.toContain("How scoring works")
    expect(guide).not.toContain("the scorer reads your history")
  })

  it("keeps tasks that followed the explainer, under a Do the tasks heading", () => {
    const { guide } = splitGuide(md)
    expect(guide).toContain("## 1. Do the tasks")
    expect(guide).toContain("### Task 1 — find hosts")
    expect(guide).toContain("## not a heading") // fenced line untouched
    expect(guide).toContain("## 2. Common failures & fixes")
    expect(guide.startsWith("## Scenario 1 — Recon\nintro line")).toBe(true)
  })

  it("never treats a later heading that merely mentions scoring as the explainer", () => {
    const { scoring, guide } = splitGuide("## T\n## 2. How scoring works\nreal\n## 5. Playground (not required for scoring)\nplay")
    expect(scoring).toBe("real")
    expect(guide).toContain("Playground (not required for scoring)")
  })

  it("returns null parts when a guide has no such sections", () => {
    const out = splitGuide("## Title\n## 2. Only this\ntext")
    expect(out.tools).toBeNull()
    expect(out.scoring).toBeNull()
  })
})

describe("every scenario guide splits cleanly for the lab panel", () => {
  const dir = path.join(__dirname, "..", "..", "public", "scenarios")

  it.each(SCENARIOS.map((s) => [s.displayNumber, s.guideFile] as const))("Scenario %i (%s)", (_n, guideFile) => {
    const md = fs.readFileSync(path.join(dir, guideFile), "utf8")
    const { guide, tools, scoring } = splitGuide(md)
    expect(tools).not.toBeNull()
    expect(tools!.body.length).toBeGreaterThan(80)
    expect(scoring).not.toBeNull()
    expect(scoring!.length).toBeGreaterThan(80)
    expect(guide).not.toMatch(/big picture/i)
    expect(guide).not.toMatch(/^##\s+\d+\.\s+How scoring works/im)
    expect(guide).toMatch(/^## 1\. /m)
    // Nothing is lost: every task heading survives in the guide, not the pop-ups.
    const tasks = (md.match(/^### Task \d/gm) || []).length
    expect(tasks).toBeGreaterThan(0)
    expect((guide.match(/^### Task \d/gm) || []).length).toBe(tasks)
    expect(scoring).not.toMatch(/^### Task \d/m)
  })
})

// A table header whose first cell is "#" ("# | Milestone | ...") is parsed as
// a Markdown heading, which breaks the whole table (seen in Scenarios 2–4).
describe("guide tables are not swallowed by headings", () => {
  const dir = path.join(__dirname, "..", "..", "public", "scenarios")

  it.each(SCENARIOS.map((s) => [s.displayNumber, s.guideFile] as const))("Scenario %i (%s)", (_n, guideFile) => {
    const md = fs.readFileSync(path.join(dir, guideFile), "utf8")
    expect(md).not.toMatch(/^#{1,6}\s*\|/m)
  })
})
