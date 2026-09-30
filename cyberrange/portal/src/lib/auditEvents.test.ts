import { auditEventLabel, auditResultVariant, parseAuditDetail } from "./auditEvents"

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
