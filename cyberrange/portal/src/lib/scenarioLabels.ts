/**
 * Canonical scenario ID → display label mapping.
 *
 * Source: INSTRUCTOR_API_HANDOFF.md §2.1 "Scenario Catalog & Preserved Scenario Mapping"
 *   Scenario 1  → scenario_id = 1  → Network Reconnaissance
 *   Scenario 2  → scenario_id = 6  → Web Application Attack SQL Injection / DVWA
 *   Scenario 3  → scenario_id = 9  → SIEM Alert Triage and Log Analysis
 *   Scenario 4  → scenario_id = 11 → Vulnerability Hardening
 */
const SCENARIO_LABELS: Record<number, string> = {
  1: "Scenario 1: Network Reconnaissance",
  6: "Scenario 2: Web Application Attack / SQL Injection",
  9: "Scenario 3: SIEM Alert Triage and Log Analysis",
  11: "Scenario 4: Vulnerability Hardening",
};

/**
 * Returns the human-readable scenario label for a given scenario_id.
 * Falls back to "Scenario <id>" for unknown IDs.
 */
export function formatScenarioName(scenarioId: number | string | null): string {
  if (scenarioId === null || scenarioId === undefined) return "Scenario -";
  const id = Number(scenarioId);
  return SCENARIO_LABELS[id] ?? `Scenario ${scenarioId}`;
}

/**
 * Short form for tight table cells: "Scenario 3" for scenario_id 9.
 * Instructors know the labs as 1-4, never the internal ids 1/6/9/11.
 */
export function formatScenarioNumber(scenarioId: number | string | null | undefined): string {
  if (scenarioId === null || scenarioId === undefined) return "—";
  const label = SCENARIO_LABELS[Number(scenarioId)];
  return label ? label.slice(0, label.indexOf(":")) : `Scenario ${scenarioId}`;
}

/**
 * Returns the milestone label for a review case.
 * A null milestone_id means the case covers the whole scenario
 * (INSTRUCTOR_API_HANDOFF.md §2.3: "Overall Report").
 */
export function formatMilestoneLabel(milestoneId: number | null | undefined): string {
  if (milestoneId === null || milestoneId === undefined) return "Overall Report";
  return `Milestone ${milestoneId}`;
}
