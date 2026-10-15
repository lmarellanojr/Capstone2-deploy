import { auditActor, auditEventLabel, auditResultVariant, parseAuditDetail } from "./auditEvents"

describe("parseAuditDetail", () => {
  it("separates the acting admin from the other facts", () => {
    expect(parseAuditDetail("actor=admin_demo role=instructor previous=student")).toEqual({
      actor: "admin_demo",
      facts: "role=instructor previous=student",
    })
  })

  it("handles a force-destroy detail", () => {
    expect(parseAuditDetail("actor=admin_demo previous_status=ACTIVE")).toEqual({
      actor: "admin_demo",
      facts: "previous_status=ACTIVE",
    })
  })

  it("copes with no actor, empty and null details", () => {
    expect(parseAuditDetail("review_id=7")).toEqual({ actor: null, facts: "review_id=7" })
    expect(parseAuditDetail("")).toEqual({ actor: null, facts: "" })
    expect(parseAuditDetail(null)).toEqual({ actor: null, facts: "" })
  })
})

describe("labels and result colors", () => {
  it("names known events and passes unknown ones through", () => {
    expect(auditEventLabel("ADMIN_POD_FORCE_DESTROY")).toBe("Pod force-destroyed")
    expect(auditEventLabel("ADMIN_USER_PASSWORD_RESET")).toBe("Password reset")
    expect(auditEventLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW")
  })

  it("maps results to badge variants", () => {
    expect(auditResultVariant("OK")).toBe("success")
    expect(auditResultVariant("failed")).toBe("danger")
    expect(auditResultVariant("DENIED")).toBe("warning")
    expect(auditResultVariant(null)).toBe("default")
  })
})

describe("auditActor", () => {
  const ev = (event_type: string, detail: string | null, student_id: string | null = "student1") => ({
    event_type,
    student_id,
    detail,
  })

  it("uses actor= when the writer recorded one", () => {
    expect(auditActor(ev("ADMIN_USER_ROLE_SET", "actor=admin_demo role=instructor previous=student"))).toEqual({
      actor: "admin_demo",
      system: false,
      facts: "role=instructor previous=student",
    })
  })

  it("uses graded_by= for review grading and drops it from the facts", () => {
    expect(auditActor(ev("REVIEW_CASE_RESOLVED", "review_id=7, score=80, graded_by=instructor1"))).toEqual({
      actor: "instructor1",
      system: false,
      facts: "review_id=7, score=80",
    })
  })

  it("shows auto-grading as the system", () => {
    expect(auditActor(ev("REVIEW_CASE_RESOLVED", "review_id=7, score=100, graded_by=SYSTEM_HYBRID"))).toEqual({
      actor: "System (auto-grade)",
      system: true,
      facts: "review_id=7, score=100",
    })
  })

  it("credits the student for events on their own account", () => {
    expect(auditActor(ev("REVIEW_CASE_RESUBMITTED", "review_id=7")).actor).toBe("student1")
    expect(auditActor(ev("SCENARIO_PROGRESS_RESET", "scenario_id=1, 3 milestone row(s) deleted")).actor).toBe("student1")
    expect(auditActor(ev("HYBRID_SCORE_PASS", "Scenario 1, Milestone 2: Flag and state corroborated.")).actor).toBe(
      "student1",
    )
  })

  it("marks provisioning and reaper events as the system", () => {
    expect(auditActor(ev("PROVISION_SUCCESS", null))).toEqual({ actor: "System", system: true, facts: "" })
    expect(auditActor(ev("POD_TTL_REAP", null)).actor).toBe("System")
    expect(auditActor(ev("REVIEW_CASE_RESUBMITTED", "review_id=7", null)).actor).toBe("System")
  })
})
