// "Before you start — the big picture" lives as section 0 of every scenario
// guide (public/scenarios/*.md). The welcome modal shows exactly that section,
// so the guide stays the single source of truth for its wording.

const H2 = /^##\s/
const FENCE = /^\s*(```|~~~)/

function isBigPictureHeading(line: string): boolean {
  return /^##\s+0\.\s/.test(line) || (H2.test(line) && /big picture/i.test(line))
}

/** The body of the guide's "## 0. Before you start — the big picture"
 *  section (heading excluded), up to the next `## ` heading. `###` sub-headings
 *  stay inside it, and `## ` lines inside a code fence don't end it. Returns
 *  null when the guide has no such section or it's empty. */
export function extractBigPicture(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex(isBigPictureHeading)
  if (start === -1) return null

  let end = lines.length
  let inFence = false
  for (let i = start + 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence
    if (!inFence && H2.test(lines[i])) {
      end = i
      break
    }
  }

  const body = lines.slice(start + 1, end).join('\n').trim()
  return body.length > 0 ? body : null
}

const NUMBERED_H2 = /^(##\s+)(\d+)\.(\s+.*)$/
const TOOLS_H2 = /^##\s+1\.\s+(.*)$/
// Anchored at the heading start so e.g. "Payload playground (… not required
// for scoring)" is never mistaken for the scoring explainer.
const SCORING_H2 = /^##\s+(?:\d+\.\s+)?how scoring works\b/i

interface Section {
  heading: string // the "## ..." line; "" for text before the first heading
  lines: string[] // body lines after the heading
}

// Split on `## ` headings, ignoring any that sit inside a code fence.
function h2Sections(markdown: string): Section[] {
  const out: Section[] = [{ heading: "", lines: [] }]
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence
    if (!inFence && H2.test(line)) out.push({ heading: line, lines: [] })
    else out[out.length - 1].lines.push(line)
  }
  return out
}

// A thematic break is a line that is only `---` (or `***` / `___`) — not a
// table's `--- | ---` separator row.
const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/
const H3 = /^###\s/

/** Split section lines at the first thematic break or `###` heading outside a
 *  code fence. The break line itself is dropped. */
function splitAtFirstBreak(lines: string[]): [string[], string[]] {
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence
    if (inFence) continue
    if (THEMATIC_BREAK.test(lines[i])) return [lines.slice(0, i), lines.slice(i + 1)]
    if (H3.test(lines[i])) return [lines.slice(0, i), lines.slice(i)]
  }
  return [lines, []]
}

export interface SplitGuide {
  /** What the Guide tab shows: everything except the Big Picture, Tools and
   *  scoring sections, with the remaining numbered headings renumbered from 1. */
  guide: string
  /** Section "1." (the tools / key pieces), opened from the terminal's Tools icon. */
  tools: { heading: string; body: string } | null
  /** The "How scoring works" section, opened from the Score card. */
  scoring: string | null
}

/** Splits a scenario guide for the lab panel. The Big Picture ("## 0.") has
 *  its own welcome modal, the tools section ("## 1.") and "How scoring works"
 *  open as pop-ups from the terminal and the Score card, so the step-by-step
 *  Guide stays focused on the tasks. Nothing is rewritten except heading
 *  numbers; the source file stays the single source of truth. */
export function splitGuide(markdown: string): SplitGuide {
  let tools: SplitGuide["tools"] = null
  let scoring: string | null = null
  const kept: string[] = []
  let n = 0
  for (const section of h2Sections(markdown)) {
    if (section.heading && isBigPictureHeading(section.heading)) continue
    const toolsMatch: RegExpExecArray | null = !tools && section.heading ? TOOLS_H2.exec(section.heading) : null
    if (toolsMatch) {
      tools = { heading: toolsMatch[1].trim(), body: section.lines.join("\n").trim() }
      continue
    }
    if (scoring === null && SCORING_H2.test(section.heading)) {
      // Scenario 1 keeps its tasks inside this section, after a `---` rule.
      // Only the explainer moves to the pop-up; the tasks stay in the Guide.
      const [explainer, rest] = splitAtFirstBreak(section.lines)
      scoring = explainer.join("\n").trim()
      if (rest.some((l) => l.trim())) {
        kept.push(`## ${++n}. Do the tasks`)
        kept.push(...rest)
      }
      continue
    }
    const numbered = NUMBERED_H2.exec(section.heading)
    if (numbered) kept.push(`${numbered[1]}${++n}.${numbered[3]}`)
    else if (section.heading) kept.push(section.heading)
    kept.push(...section.lines)
  }
  return { guide: kept.join("\n").trim(), tools, scoring }
}

/** The walkthrough for a single task: the `### Task N …` section (heading
 *  included), up to the next `###` or `## ` heading outside a code fence.
 *  Returns null when the guide has no such task section, so callers can fall
 *  back to the full guide (scenarios that don't use `### Task N` headings). */
export function extractTaskSection(markdown: string, taskNumber: number): string | null {
  const heading = new RegExp(`^###\\s+Task\\s+${taskNumber}\\b`, "i")
  const lines = markdown.split(/\r?\n/)

  let start = -1
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence
    if (!inFence && heading.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return null

  let end = lines.length
  inFence = false
  for (let i = start + 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence
    if (!inFence && (H2.test(lines[i]) || H3.test(lines[i]))) {
      end = i
      break
    }
  }

  const body = lines.slice(start, end).join("\n").trim()
  return body.length > 0 ? body : null
}

/** The task numbers that have a `### Task N` heading in the guide (outside
 *  code fences), ascending. */
export function guideTaskNumbers(markdown: string): number[] {
  const nums: number[] = []
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence
    if (inFence) continue
    const m = /^###\s+Task\s+(\d+)\b/i.exec(line)
    if (m) nums.push(Number(m[1]))
  }
  return nums.sort((a, b) => a - b)
}

/** Whether the guide's `### Task N` headings map 1:1 onto `milestoneCount`
 *  milestones — exactly the numbers 1..milestoneCount, each once. The per-task
 *  walkthrough relies on the contract "milestone index i ↔ `### Task i+1`", so
 *  callers show a single task's section only when this holds; otherwise they
 *  fall back to the full guide. Guards against guides whose task numbering is
 *  offset (e.g. Scenario 3 starts at `### Task 0`) or whose count differs from
 *  the milestone list, which would otherwise silently drop a task's content. */
export function tasksAlignWithMilestones(markdown: string, milestoneCount: number): boolean {
  if (milestoneCount <= 0) return false
  const nums = guideTaskNumbers(markdown)
  return nums.length === milestoneCount && nums.every((n, i) => n === i + 1)
}

// Guides are static files; one fetch per guide per page load is enough.
const cache = new Map<string, Promise<string>>()

/** Fetches a scenario guide's raw markdown (pod IP placeholders not yet
 *  substituted). Shared by the Guide and Tools tabs and the Big Picture. */
export function loadGuideMarkdown(guideFile: string): Promise<string> {
  let pending = cache.get(guideFile)
  if (!pending) {
    pending = fetch(`/scenarios/${guideFile}`).then((res) => {
      if (!res.ok) throw new Error(`Guide not found (${res.status})`)
      return res.text()
    })
    // A failed fetch must not be cached forever — let the next open retry.
    pending.catch(() => cache.delete(guideFile))
    cache.set(guideFile, pending)
  }
  return pending
}

/** Fetches a scenario guide and returns its Big Picture section (raw
 *  markdown, pod IP placeholders not yet substituted). */
export function loadBigPicture(guideFile: string): Promise<string | null> {
  return loadGuideMarkdown(guideFile).then(extractBigPicture)
}
