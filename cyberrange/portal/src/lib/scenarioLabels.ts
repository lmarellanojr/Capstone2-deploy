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
