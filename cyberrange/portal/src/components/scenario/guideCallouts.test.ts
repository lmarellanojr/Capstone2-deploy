import { classifyCallout, classifyCue } from "./guideCallouts"

describe("classifyCallout", () => {
  it.each([
    ["What you're doing & why: before you can attack…", "teaching"],
    ["What you are doing & why", "teaching"],
    ["What you can do with this: you now have a host map", "unlock"],
    ["Why exit matters: Manual Check reads your history", "warning"],
    ["Required — or you get no session", "warning"],
    ["Important: DVWA access", "warning"],
    ["Do not run -p- first", "warning"],
    ["Network: your pod uses $TARGET_SUBNET", "info"],
    ["Path: browser-only via Open DVWA", "info"],
    ["Scoring detail: the checker looks for -sV", "info"],
    ["Templates: unedited examples do not pass", "tip"],
    ["Make it real: use the event from this run", "tip"],
    ["Something friendly and unlabelled", "tip"],
  ])("classifies %j as %s", (lead, expected) => {
    expect(classifyCallout(lead)).toBe(expected)
  })

  it("prefers the teaching lead even though it contains the word 'why'", () => {
    expect(classifyCallout("What you're doing & why")).toBe("teaching")
  })
})

describe("classifyCue", () => {
  it.each([
    ["Goal:", "goal"],
    ["goal", "goal"],
    ["Done when:", "done"],
    ["Done", "done"],
    ["Then:", "next"],
    ["Points:", null],
    ["DVWA", null],
    ["Task 1 — Host Discovery", null],
  ])("maps %j to %s", (label, expected) => {
    expect(classifyCue(label)).toBe(expected)
  })
})
