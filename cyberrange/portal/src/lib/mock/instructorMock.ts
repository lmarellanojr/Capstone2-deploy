// Placeholder data for the Instructor review queue shell. Not wired to any API.
// Replace once #34 (review queue/detail integration) lands.

export type ReviewStatus = "pending" | "approved" | "rejected" | "retry";

export interface MockReviewCase {
  id: string;
  student: string;
  scenario: string;
  milestone: string;
  submitted: string;
  status: ReviewStatus;
}

export const mockReviewQueue: MockReviewCase[] = [
  { id: "case-0142", student: "Juan Dela Cruz", scenario: "06 - SQL Injection", milestone: "Milestone 2", submitted: "2026-09-15 13:02", status: "pending" },
  { id: "case-0141", student: "Pedro Reyes", scenario: "09 - SIEM Triage", milestone: "Milestone 1", submitted: "2026-09-15 10:47", status: "pending" },
  { id: "case-0139", student: "Maria Santos", scenario: "01 - Network Recon", milestone: "Milestone 3", submitted: "2026-09-14 08:55", status: "retry" },
  { id: "case-0137", student: "Ana Lopez", scenario: "11 - Vulnerability Hardening", milestone: "Milestone 1", submitted: "2026-09-12 19:10", status: "rejected" },
  { id: "case-0130", student: "Juan Dela Cruz", scenario: "06 - SQL Injection", milestone: "Milestone 1", submitted: "2026-09-09 15:30", status: "approved" },
];
