/** Display SIEM corroboration separately from milestone completion and points. */
export function describeSiemDetection(
  scenarioId: number | string,
  milestoneId: number,
  score?: number | null,
): string {
  if (score == null || !Number.isFinite(score) || score < 0) return "Unknown"
  // Preserve recorded evidence even if current detection configuration changes.
  if (score > 0) return "Detected"

  // Current catalog configuration from provisioning/wazuh_rule_map.py.
  // Keep in sync when web detection or additional catalog rules are enabled.
  // Unknown/legacy scenarios are not assumed to be unconfigured.
  const scenario = Number(scenarioId)
  if ([1, 6, 11].includes(scenario) || (scenario === 9 && milestoneId > 1)) {
    return "Not configured"
  }
  return "Not detected"
}
