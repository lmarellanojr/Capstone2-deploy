// Instructor-facing wording for Scenario 3 check failure reasons. Codes come
// from the backend allowlist (scoring_diagnostics.REASON_CODES); anything else
// is shown as a check error rather than echoed.

export interface ReasonCopy {
  label: string;
  detail: string;
}

export const REASON_COPY: Record<string, ReasonCopy> = {
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

export const SCENARIO3_MILESTONES: Record<number, string> = {
  1: "1: Triage record",
  2: "2: Timeline",
  3: "3: Incident report",
};

export function reasonCopy(code: string | null): ReasonCopy | null {
  if (code === null) return null;
  return REASON_COPY[code] ?? REASON_COPY.CHECK_ERROR;
}

export function locationLabel(location: string | null): string {
  return (location && LOCATION_LABELS[location]) || "—";
}
