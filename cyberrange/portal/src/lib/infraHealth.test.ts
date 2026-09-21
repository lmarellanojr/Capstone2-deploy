import { badgeVariantForStatus, unavailableServicesFromError } from "./infraHealth"

describe("infraHealth", () => {
  it("maps Healthy/Degraded/Unavailable to badge variants", () => {
    expect(badgeVariantForStatus("Healthy")).toBe("success")
    expect(badgeVariantForStatus("Degraded")).toBe("warning")
    expect(badgeVariantForStatus("Unavailable")).toBe("danger")
  })

  it("never reports Healthy when the fetch failed", () => {
    const rows = unavailableServicesFromError("API unreachable")
    expect(rows.every((r) => r.status === "Unavailable")).toBe(true)
    expect(rows.some((r) => r.status === "Healthy")).toBe(false)
  })
})
