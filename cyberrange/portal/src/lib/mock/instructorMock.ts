// Placeholder data for the UI-01 Instructor route shell. Not wired to any API.
// Replace with real queries once the review-case backend (DB-01/AUTH-02) lands.

export interface MockStudent {
  id: string;
  name: string;
  email: string;
  progress: number;
  activePod: string | null;
  lastActivity: string;
}

export const mockStudents: MockStudent[] = [
  { id: "s1", name: "Juan Dela Cruz", email: "juan.delacruz@example.edu", progress: 72, activePod: "pod-a1f9", lastActivity: "2026-09-15 14:20" },
  { id: "s2", name: "Maria Santos", email: "maria.santos@example.edu", progress: 45, activePod: null, lastActivity: "2026-09-14 09:05" },
  { id: "s3", name: "Pedro Reyes", email: "pedro.reyes@example.edu", progress: 90, activePod: "pod-77c2", lastActivity: "2026-09-15 11:41" },
  { id: "s4", name: "Ana Lopez", email: "ana.lopez@example.edu", progress: 18, activePod: null, lastActivity: "2026-09-10 16:33" },
];

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
