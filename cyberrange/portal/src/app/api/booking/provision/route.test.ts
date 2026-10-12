import { NextRequest } from "next/server"

describe("public booking provision proxy", () => {
  const originalSecret = process.env.BOOKING_PROVISION_SECRET
  const originalApi = process.env.API_INTERNAL_URL

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
    if (originalSecret === undefined) delete process.env.BOOKING_PROVISION_SECRET
    else process.env.BOOKING_PROVISION_SECRET = originalSecret
    if (originalApi === undefined) delete process.env.API_INTERNAL_URL
    else process.env.API_INTERNAL_URL = originalApi
  })

  it("rejects callers without the server secret", async () => {
    process.env.BOOKING_PROVISION_SECRET = "expected"
    const fetchMock = jest.spyOn(global, "fetch")
    const { POST } = await import("./route")
    const response = await POST(new NextRequest("https://portal.test/api/booking/provision", { method: "POST", body: JSON.stringify({ email: "tester@mmdc.mcl.edu.ph" }) }))
    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("forwards only the email and returns no account identifiers", async () => {
    process.env.BOOKING_PROVISION_SECRET = "expected"
    process.env.API_INTERNAL_URL = "http://api.internal:5000/"
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "created", credential_email_status: "sent", username: "private-user" }), { status: 200 }))
    const { POST } = await import("./route")
    const response = await POST(new NextRequest("https://portal.test/api/booking/provision", {
      method: "POST",
      headers: { "X-Booking-Provision-Secret": "expected", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "tester@mmdc.mcl.edu.ph", role: "admin" }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "created", credential_email_status: "sent" })
    expect(global.fetch).toHaveBeenCalledWith("http://api.internal:5000/internal/booking/user", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Booking-Provision-Secret": "expected" }),
      body: JSON.stringify({ email: "tester@mmdc.mcl.edu.ph" }),
    }))
  })
})
