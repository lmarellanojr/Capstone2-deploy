import {
  AUTH_SERVICE_UNAVAILABLE,
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

  it("puts the error on API and marks LXD, Keycloak and Wazuh as not checked", () => {
    const rows = servicesFromFetchFailure("API unreachable", 503)
    expect(rows).toEqual([
      { name: "API", status: "Unavailable", detail: "API unreachable" },
      { name: "LXD", status: "Unavailable", detail: "not checked (API unreachable)" },
      { name: "Keycloak", status: "Unavailable", detail: "not checked (API unreachable)" },
      { name: "Wazuh", status: "Unavailable", detail: "not checked (API unreachable)" },
    ])
  })

  it("returns no fabricated rows for 401/403 (banner only)", () => {
    expect(servicesFromFetchFailure("Authentication expired. Please log in again.", 401)).toEqual([])
    expect(servicesFromFetchFailure("Forbidden", 403)).toEqual([])
  })

  it("blames Keycloak, not the API, when the API cannot verify the session", () => {
    const rows = servicesFromFetchFailure("Service unavailable", 503, AUTH_SERVICE_UNAVAILABLE)
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(byName.Keycloak.status).toBe("Unavailable")
    expect(byName.API.status).toBe("Degraded")
    expect(byName.LXD.status).toBe("Unavailable")
    expect(byName.Wazuh.status).toBe("Unavailable")
    expect(rows.some((r) => r.status === "Healthy")).toBe(false)
  })

  it("does not blame Keycloak for other 503s", () => {
    const rows = servicesFromFetchFailure("API unreachable", 503, undefined)
    expect(rows.find((r) => r.name === "API")?.status).toBe("Unavailable")
    expect(rows.find((r) => r.name === "Keycloak")?.detail).toBe("not checked (API unreachable)")
  })
})
