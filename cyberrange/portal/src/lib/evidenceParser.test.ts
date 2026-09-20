import { parseEvidenceData } from "./evidenceParser"

describe("parseEvidenceData", () => {
  it("formats valid JSON string with indentation", () => {
    const jsonStr = '{"command":"nmap -sV","output":"Open ports: 22, 80"}'
    const result = parseEvidenceData(jsonStr)
    expect(result).toBe(JSON.stringify(JSON.parse(jsonStr), null, 2))
  })

  it("formats valid JSON array with indentation", () => {
    const jsonArr = '[{"alert_id":"001","level":5},{"alert_id":"002","level":7}]'
    const result = parseEvidenceData(jsonArr)
    expect(result).toBe(JSON.stringify(JSON.parse(jsonArr), null, 2))
  })

  it("handles object directly passed as evidenceData", () => {
    const obj = { scenario: 6, score: 100 }
    const result = parseEvidenceData(obj)
    expect(result).toBe(JSON.stringify(obj, null, 2))
  })

  it("falls back to raw string when JSON is malformed", () => {
    const malformed = '{"incomplete": true, '
    const result = parseEvidenceData(malformed)
    expect(result).toBe(malformed)
  })

  it("returns plain text unchanged", () => {
    const text = "Found backdoor in /tmp/backdoor.sh running on port 4444"
    const result = parseEvidenceData(text)
    expect(result).toBe(text)
  })

  it("returns default message for null and undefined", () => {
    expect(parseEvidenceData(null)).toBe("No evidence attached.")
    expect(parseEvidenceData(undefined)).toBe("No evidence attached.")
    expect(parseEvidenceData("")).toBe("No evidence attached.")
    expect(parseEvidenceData("   ")).toBe("No evidence attached.")
  })

  it("preserves HTML/script tags as plain text without throwing", () => {
    const malicious = '<script>alert("xss")</script>'
    const result = parseEvidenceData(malicious)
    expect(result).toBe(malicious)
  })
})
