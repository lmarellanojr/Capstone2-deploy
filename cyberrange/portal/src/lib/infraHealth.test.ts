import {
  badgeVariantForStatus,
  servicesFromFetchFailure,
} from "./infraHealth"

describe("infraHealth", () => {
  it("maps Healthy/Degraded/Unavailable to badge variants", () => {
    expect(badgeVariantForStatus("Healthy")).toBe("success")
    expect(badgeVariantForStatus("Degraded")).toBe("warning")
    expect(badgeVariantForStatus("Unavailable")).toBe("danger")
  })

  it("never reports Healthy when the fetch failed", () => {
    const rows = servicesFromFetchFailure("API unreachable")
    expect(rows.every((r) => r.status === "Unavailable")).toBe(true)
    expect(rows.some((r) => r.status === "Healthy")).toBe(false)
  })

  it("puts the error on API and marks LXD as not checked", () => {
    const rows = servicesFromFetchFailure("API unreachable", 503)
    expect(rows).toEqual([
      { name: "API", status: "Unavailable", detail: "API unreachable" },
      { name: "LXD", status: "Unavailable", detail: "not checked (API unreachable)" },
    ])
  })

  it("returns no fabricated rows for 401/403 (banner only)", () => {
    expect(servicesFromFetchFailure("Authentication expired. Please log in again.", 401)).toEqual([])
    expect(servicesFromFetchFailure("Forbidden", 403)).toEqual([])
  })
})
