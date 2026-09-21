/**
 * Safely parse and format evidence data submitted with review cases.
 * Handles JSON strings, objects, plain text, and null/undefined values.
 * Never executes scripts or produces unsafe HTML.
 */
export function parseEvidenceData(evidenceData: unknown): string {
  if (evidenceData === null || evidenceData === undefined || evidenceData === "") {
    return "No evidence attached."
  }

  if (typeof evidenceData === "object") {
    try {
      return JSON.stringify(evidenceData, null, 2)
    } catch {
      return String(evidenceData)
    }
  }

  if (typeof evidenceData === "string") {
    const trimmed = evidenceData.trim()
    if (!trimmed) {
      return "No evidence attached."
    }
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return evidenceData
      }
    }
    return evidenceData
  }

  return String(evidenceData)
}
