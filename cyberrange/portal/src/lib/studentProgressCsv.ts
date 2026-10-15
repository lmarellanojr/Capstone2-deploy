import type { InstructorMilestone, ReviewCase, SiemAlert } from "@/lib/api"
import { SCENARIOS } from "@/hooks/useScenarios"
import { describeSiemDetection } from "@/lib/siemDetection"
import { formatScenarioNumber } from "@/lib/scenarioLabels"
import { earnedPointsForAttempt } from "@/lib/scenarioProgress"
import { rowsToCsv } from "@/lib/csvExport"

export function milestoneCsvRows(milestones: InstructorMilestone[]): Array<Array<unknown>> {
  return milestones.map((m) => [
    formatScenarioNumber(m.scenario_id),
    m.scenario_id,
    m.milestone_id,
    m.status,
    earnedPointsForAttempt(m, SCENARIOS),
    m.detection_score ?? "",
    describeSiemDetection(m.scenario_id, m.milestone_id, m.detection_score),
    m.detection_data ?? "",
    m.pod_id ?? "",
    m.verified_at ?? "",
  ])
}

export const MILESTONE_CSV_HEADERS = [
  "scenario_label",
  "scenario_id",
  "milestone_id",
  "status",
  "points",
  "detection_score",
  "siem_detection",
  "detection_data",
  "pod_id",
  "verified_at",
]

export function reviewCsvRows(reviews: ReviewCase[]): Array<Array<unknown>> {
  return reviews.map((r) => [
    formatScenarioNumber(r.scenario_id),
    r.scenario_id,
    r.review_id,
    r.case_type,
    r.status,
    r.score ?? "",
    r.created_at,
    r.updated_at,
    r.graded_by ?? "",
    r.feedback ?? "",
  ])
}

export const REVIEW_CSV_HEADERS = [
  "scenario_label",
  "scenario_id",
  "review_id",
  "case_type",
  "status",
  "score",
  "created_at",
  "updated_at",
  "graded_by",
  "feedback",
]

export function alertCsvRows(alerts: SiemAlert[]): Array<Array<unknown>> {
  return alerts.map((a) => [
    a.timestamp,
    a.rule_id,
    a.rule_level,
    a.agent_name,
    a.agent_id,
    a.rule_description,
  ])
}

export const ALERT_CSV_HEADERS = [
  "timestamp",
  "rule_id",
  "rule_level",
  "agent_name",
  "agent_id",
  "rule_description",
]

/** One downloadable workbook-style text file: milestones, reviews, then optional alerts. */
export function buildStudentProgressCsv(args: {
  studentId: string
  milestones: InstructorMilestone[]
  reviews: ReviewCase[]
  alerts?: SiemAlert[]
  alertsLabel?: string
}): string {
  const parts: string[] = [
    `# student_id,${args.studentId}`,
    `# section,milestones`,
    rowsToCsv(MILESTONE_CSV_HEADERS, milestoneCsvRows(args.milestones)).trimEnd(),
    "",
    `# section,reviews`,
    rowsToCsv(REVIEW_CSV_HEADERS, reviewCsvRows(args.reviews)).trimEnd(),
  ]
  if (args.alerts) {
    parts.push(
      "",
      `# section,alerts${args.alertsLabel ? ` (${args.alertsLabel})` : ""}`,
      rowsToCsv(ALERT_CSV_HEADERS, alertCsvRows(args.alerts)).trimEnd(),
    )
  }
  return `${parts.join("\r\n")}\r\n`
}
