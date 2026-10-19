// Instructor-facing wording for check failure reasons, per scorer scenario id.
// Codes come from the backend allowlist (scoring_diagnostics.
// REASON_CODES_BY_SCENARIO); anything else is shown as a check error rather
// than echoed.

export interface ReasonCopy {
  label: string;
  detail: string;
}

export interface ScenarioDiagnostics {
  /** Catalog title, e.g. "Scenario 3 — SIEM Alert Triage". */
  title: string;
  milestones: Record<number, string>;
  reasons: Record<string, ReasonCopy>;
  /** Artifact checks: show where the file was read and duplicate copies. */
  showsLocation: boolean;
}

export const SCENARIO3_REASON_COPY: Record<string, ReasonCopy> = {
  ARTIFACT_MISSING: {
    label: "File missing",
    detail: "No artifact with the expected name in /home/msfadmin, /home/student, or /tmp on meta.",
  },
  ARTIFACT_UNREADABLE: {
    label: "File unreadable",
    detail: "The artifact exists but the check could not read it (permissions).",
  },
  ARTIFACT_INVALID: {
    label: "Required content missing",
    detail: "Triage: none of alert_id / severity / rule. Report: none of system, attack, alert, recommend.",
  },
  PLACEHOLDER_OR_EXAMPLE: {
    label: "Placeholder or guide example",
    detail: "Unfilled PASTE… / HH:MM / <…> text, or the guide's fictional example values.",
  },
  AGENT_MISSING: {
    label: "Agent missing",
    detail: "No pod-…-meta agent name found. On a one-line file, the agent may be on a last line with no line break.",
  },
  AGENT_MISMATCH: {
    label: "Wrong agent",
    detail: "Names a pod-…-meta agent, but not this student's lab.",
  },
  RULE_MISSING: {
    label: "Rule 5710 missing",
    detail:
      "No rule number given. For the timeline: no line naming rule 5710 (written rule/Rule, not RULE, and ending in a line break).",
  },
  RULE_MISMATCH: {
    label: "Wrong rule",
    detail: "Gives a rule number, but not 5710.",
  },
  TIMESTAMP_MISSING: {
    label: "Timestamp missing",
    detail: "No full ISO-8601 …Z time (for the timeline: none on the rule 5710 line).",
  },
  TIMESTAMP_NOT_MATCHED: {
    label: "Timestamp doesn't match",
    detail: "A …Z time is given, but it is not within 5 minutes of a real invalid-user SSH event in this lab.",
  },
  REPORT_TOO_SHORT: {
    label: "Report too short",
    detail: "The report is 200 bytes or less.",
  },
  REPORT_BODY_TOO_SHORT: {
    label: "Report body too short",
    detail: "Under 120 characters of content once the five headings are removed.",
  },
  CHECK_ERROR: {
    label: "Check error",
    detail: "The check could not run or verify (lab unreachable, no auth log). Not the student's fault.",
  },
};

export const LOCATION_LABELS: Record<string, string> = {
  HOME_MSFADMIN: "/home/msfadmin",
  HOME_STUDENT: "/home/student",
  TMP: "/tmp",
  NONE: "—",
};

/** Fallback for an unmapped scenario, or a code missing from a scenario's copy.
 *  Scenario-neutral: each scenario's `reasons` carries its own CHECK_ERROR wording. */
export const CHECK_ERROR_COPY: ReasonCopy = {
  label: "Check error",
  detail: "The check could not run or verify. Not the student's fault.",
};

/** Scorer ids in catalog order (Scenario 1, 2, 3, 4). The panel sorts by this,
 *  not by object key order, which for integer keys is ascending by id. */
export const CATALOG_ORDER: readonly number[] = [1, 6, 9, 11];

/** Keyed by scorer scenario id (scoring_checks.sh). */
export const DIAGNOSTIC_SCENARIOS: Record<number, ScenarioDiagnostics> = {
  9: {
    title: "Scenario 3 — SIEM Alert Triage",
    milestones: {
      1: "1: Triage record",
      2: "2: Timeline",
      3: "3: Incident report",
    },
    reasons: SCENARIO3_REASON_COPY,
    showsLocation: true,
  },
};

export function scenarioDiagnostics(scenarioId: number): ScenarioDiagnostics | null {
  return DIAGNOSTIC_SCENARIOS[scenarioId] ?? null;
}

export function reasonCopy(scenarioId: number, code: string | null): ReasonCopy | null {
  if (code === null) return null;
  return scenarioDiagnostics(scenarioId)?.reasons[code] ?? CHECK_ERROR_COPY;
}

export function milestoneLabel(scenarioId: number, milestoneId: number): string {
  return scenarioDiagnostics(scenarioId)?.milestones[milestoneId] ?? `Milestone ${milestoneId}`;
}

export function locationLabel(location: string | null): string {
  return (location && LOCATION_LABELS[location]) || "—";
}
