// Placeholder data for the UI-01 Admin route shell. Not wired to any API.
// Replace with real queries once the pod/API contract audit (P0-01) classifies
// each admin endpoint as Reuse/Extend/New.

// Shape mirrors the eventual Users API response so swapping the source later is a one-line change.
export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "student" | "instructor" | "admin";
  status: "active" | "disabled";
  lastLogin: string;
}

export const mockUsers: MockUser[] = [
  { id: "u1", name: "Juan Dela Cruz", email: "juan.delacruz@example.edu", role: "student", status: "active", lastLogin: "2026-09-15 14:20" },
  { id: "u2", name: "Lenie Joice Mendoza", email: "lenie.mendoza@example.edu", role: "instructor", status: "active", lastLogin: "2026-09-15 09:12" },
  { id: "u3", name: "Leonardo Arellano", email: "leonardo.arellano@example.edu", role: "admin", status: "active", lastLogin: "2026-09-15 08:47" },
  { id: "u4", name: "Ana Lopez", email: "ana.lopez@example.edu", role: "student", status: "disabled", lastLogin: "2026-08-30 17:02" },
];

export type PodState = "provisioning" | "active" | "stopped" | "destroying" | "failed";

export interface MockPod {
  id: string;
  student: string;
  scenario: string;
  status: PodState;
  created: string;
}

export const mockPods: MockPod[] = [
  { id: "pod-a1f9", student: "Juan Dela Cruz", scenario: "06 - SQL Injection", status: "active", created: "2026-09-15 13:40" },
  { id: "pod-77c2", student: "Pedro Reyes", scenario: "09 - SIEM Triage", status: "active", created: "2026-09-15 10:20" },
  { id: "pod-c003", student: "Maria Santos", scenario: "01 - Network Recon", status: "provisioning", created: "2026-09-15 15:05" },
  { id: "pod-9e41", student: "Ana Lopez", scenario: "11 - Vulnerability Hardening", status: "failed", created: "2026-09-12 18:55" },
];
