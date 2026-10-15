import {
  auditActor,
  auditCategoryTypes,
  auditEventCategory,
  auditEventDescription,
  auditEventLabel,
  auditResult,
  auditResultLabel,
  auditResultVariant,
  humanizeAuditFacts,
  parseAuditDetail,
} from "./auditEvents"

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
    expect(auditEventLabel("ADMIN_POD_FORCE_DESTROY")).toBe("Lab force-destroyed")
    expect(auditEventLabel("ADMIN_USER_PASSWORD_RESET")).toBe("Password reset")
    expect(auditEventLabel("ADMIN_USER_MFA_RESET")).toBe("Authenticator reset")
    expect(auditEventLabel("DVWA_READY_FAIL")).toBe("Lab web app didn't start")
    expect(auditEventLabel("WAZUH_CLEANUP_SKIPPED")).toBe("SIEM clean-up skipped")
    expect(auditEventLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW")
    expect(auditEventDescription("SOMETHING_NEW")).toBeNull()
  })

  it("maps results to badge variants", () => {
    expect(auditResultVariant("OK")).toBe("success")
    expect(auditResultVariant("PASS")).toBe("success")
    expect(auditResultVariant("failed")).toBe("danger")
    expect(auditResultVariant("ERROR")).toBe("danger")
    expect(auditResultVariant("DENIED")).toBe("warning")
    expect(auditResultVariant("ESCALATED")).toBe("warning")
    expect(auditResultVariant(null)).toBe("default")
    expect(auditResultLabel("ESCALATED")).toBe("Needs review")
    expect(auditResultVariant("RETRY")).toBe("warning")
    expect(auditResultLabel("RETRY")).toBe("Try again")
    expect(auditResultLabel("WEIRD")).toBe("WEIRD")
  })
  it("reads the outcome from the event name when result is empty", () => {
    expect(auditResult({ event_type: "PROVISION_FAILED", result: null })).toBe("FAILED")
    expect(auditResult({ event_type: "DVWA_READY_FAIL", result: null })).toBe("FAILED")
    expect(auditResult({ event_type: "CLONE_OK", result: null })).toBe("OK")
    expect(auditResult({ event_type: "PROVISION_SUCCESS", result: null })).toBe("OK")
    expect(auditResult({ event_type: "POD_TTL_REAP", result: null })).toBeNull()
    expect(auditResult({ event_type: "ADMIN_USER_CREATE", result: "denied" })).toBe("DENIED")
  })
})

describe("categories", () => {
  it("puts every known event in exactly one category", () => {
    const admin = auditCategoryTypes("admin")
    const lab = auditCategoryTypes("lab")
    const scoring = auditCategoryTypes("scoring")
    expect(admin).toContain("ADMIN_USER_MFA_RESET")
    expect(lab).toContain("WAZUH_STALE_AGENT")
    expect(scoring).toContain("REVIEW_CASE_RESOLVED")
    const all = [...admin, ...lab, ...scoring]
    expect(new Set(all).size).toBe(all.length)
    expect(auditEventCategory("SOMETHING_NEW")).toBeNull()
  })

  it("stays within the backend's event_types limit", () => {
    for (const c of ["admin", "lab", "scoring"] as const) expect(auditCategoryTypes(c).length).toBeLessThanOrEqual(64)
  })
})

describe("humanizeAuditFacts", () => {
  it("shows a role change as before → after", () => {
    expect(humanizeAuditFacts("role=instructor previous=student")).toBe("Role: Student → Instructor")
  })

  it("explains reason codes", () => {
    expect(humanizeAuditFacts("role=admin reason=last_admin")).toBe("Role: Admin · Reason: it would leave no admin")
    expect(humanizeAuditFacts("role=student reason=keycloak rolled_back")).toBe(
      "Role: Student · Reason: Keycloak error · New account was rolled back",
    )
  })

  it("explains a skipped SIEM clean-up", () => {
    expect(humanizeAuditFacts("source=teardown reason=provisioner_not_configured")).toBe(
      "Step: lab teardown · Reason: the Wazuh provisioner user isn't set up on this host",
    )
  })

  it("words the skipped clean-up step without raw codes", () => {
    expect(humanizeAuditFacts("source=remove_by_name reason=provisioner_not_configured")).toBe(
      "Step: lab start (old agent names) · Reason: the Wazuh provisioner user isn't set up on this host",
    )
    expect(humanizeAuditFacts("source=something_new")).toBe("Step: something new")
  })

  it("formats yes/no, review ids and statuses", () => {
    expect(humanizeAuditFacts("temporary=True")).toBe("Temporary password: Yes")
    expect(humanizeAuditFacts("previous_status=ACTIVE")).toBe("Status before: Active")
    expect(humanizeAuditFacts("review_id=7, score=80")).toBe("Review: #7 · Score: 80")
  })

  it("keeps bracketed values and free text intact", () => {
    expect(humanizeAuditFacts("scenario=1, milestones=[1, 2, 3]")).toBe("Scenario: 1 · Tasks: [1, 2, 3]")
    expect(humanizeAuditFacts("[Errno 110] Connection timed out, retry")).toBe("[Errno 110] Connection timed out, retry")
    expect(humanizeAuditFacts("Scenario 1, Milestone 2: Flag valid without container state (review_id=7).")).toBe(
      "Scenario 1, Milestone 2: Flag valid without container state (review_id=7).",
    )
    expect(humanizeAuditFacts("")).toBe("")
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
    expect(auditActor(ev("WAZUH_CLEANUP_SKIPPED", "source=teardown reason=provisioner_not_configured")).actor).toBe("System")
    expect(auditActor(ev("REVIEW_CASE_RESUBMITTED", "review_id=7", null)).actor).toBe("System")
  })
})
