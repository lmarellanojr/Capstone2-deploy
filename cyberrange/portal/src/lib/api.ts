import axios from "axios"
import type { InfraHealth } from "./infraHealth"

// Same-origin App Router proxies live at /api/pods/*. NEXT_PUBLIC_* is inlined
// at `npm run build`; default so a PC build without .env.local still hits /api.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'
// Scoring API must be reached same-origin from the browser (a direct internal
// IP is unreachable through the tunnel). Defaults to /api/score; wire the
// matching rewrite in next.config.mjs once the scoring service is deployed.
const SCORING_API = process.env.NEXT_PUBLIC_SCORING_URL || '/api/score'

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        // Reached only if the silent refresh in auth.ts could not renew the token
        // (e.g. refresh token expired past SSO idle). This is now the rare backstop,
        // not the every-few-minutes path it used to be.
        console.warn("[auth] 401 after refresh attempt — forcing re-login")
        window.location.href = '/login?error=SessionExpired'
      }
    }
    return Promise.reject(error)
  }
)

export const scoringClient = axios.create({
  baseURL: SCORING_API,
  timeout: 10000,
})

scoringClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        // Reached only if the silent refresh in auth.ts could not renew the token
        // (e.g. refresh token expired past SSO idle). This is now the rare backstop,
        // not the every-few-minutes path it used to be.
        console.warn("[auth] 401 after refresh attempt — forcing re-login")
        window.location.href = '/login?error=SessionExpired'
      }
    }
    return Promise.reject(error)
  }
)

// Type definitions
// ADM-POD-UI handoff (docs/ADM-POD-UI-contract-handoff.md §4.3): the only
// statuses the backend actually sets/filters on main. ORPHANED_CLEANED is not
// produced by the API.
export interface Pod {
  pod_id: number
  student_id: string
  status: 'PROVISIONING' | 'ACTIVE' | 'DESTROYING' | 'DESTROYED' | 'FAILED_ROLLBACK_COMPLETE'
  // serialize_pod's vmid_* are container/instance name strings (e.g. "pod-student1-kali"),
  // not numeric ids -- fixing a pre-existing TS/runtime mismatch (handoff doc §4.5).
  vmid_kali: string | null
  vmid_meta: string | null
  vmid_dvwa: string | null
  connection_id: number | null
  wazuh_agent_id: string | null
  scenario_id: string | null
  created_at: string | null
  last_heartbeat: string | null
  ttl_hours: number
  remaining_seconds: number
  expires_at: string | null
  ttl_expired: boolean
}

// GET /capacity -- unauthenticated, same payload for every caller (handoff doc §4.4).
export interface Capacity {
  available_mb: number | null
  active_pods: number
  max_pods: number
  pod_ram_mb: number
  ram_buffer_mb: number
  ram_required_mb: number
  profile: string
  can_provision: boolean
}

export interface ProvisionResponse {
  pod_id: number
  vmid_kali: number
  vmid_meta: number
  vmid_dvwa: number
  status: string
}

export interface Score {
  pod_id: number
  total_points: number
  milestones_completed: number
  level: string
  detection_score?: number
}

export interface Scenario {
  id: string
  name: string
  description: string
  difficulty: 1 | 2 | 3
  mitre: string
  type: 'offensive' | 'defensive'
}

export type SiemAlert = {
  timestamp: string
  agent_id: string
  agent_name: string
  rule_id: string
  rule_description: string
  rule_level: number
}

// Instructor API types
// serialize_instructor_pod (pods_router.py) = serialize_pod row minus vmid_*/connection_id/wazuh_agent_id
export interface InstructorPod {
  id: number
  student_id: string
  pod_id: number
  status: string
  last_heartbeat: string | null
  created_at: string | null
  scenario_id: string | null
  ttl_hours: number
  remaining_seconds: number
  expires_at: string | null
  ttl_expired: boolean
}

export interface InstructorMilestone {
  scenario_id: number
  milestone_id: number
  status: string
  detection_score?: number
  /** Which lab the attempt ran on (GET /instructor/students/{id} only). */
  pod_id?: number
  /** What corroborated it: "rule 5710 on agent 012", "browser:sqli-m1", ... */
  detection_data?: string | null
  verified_at?: string
}

// Full review_cases row, as returned by GET /instructor/students/{id}
export interface ReviewCase {
  review_id: number
  student_id: string
  scenario_id: number
  milestone_id: number | null
  case_type: 'WRITTEN_REPORT' | 'SCORING_CONFLICT' | 'MANUAL_REVIEW'
  report_text: string | null
  conflict_reason: string | null
  evidence_data: string | null
  score: number | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETRY'
  feedback: string | null
  graded_by: string | null
  created_at: string
  updated_at: string
}

export interface InstructorStudentSummary {
  student_id: string
  active_pod: InstructorPod | null
  milestones: InstructorMilestone[]
  pending_review_count: number
}

export interface InstructorStudentDetail {
  student_id: string
  active_pod: InstructorPod | null
  milestones: InstructorMilestone[]
  reviews: ReviewCase[]
}

// GET /instructor/pods: serialize_instructor_pod + that student's milestone
// history for the pod's scenario (pods_router.instructor_list_pods).
export interface InstructorPodWithProgress extends InstructorPod {
  milestones: InstructorMilestone[]
}

// ADM-USER — users_router.serialize_user. One app role per account (AUTH-03);
// `role` is null when the account holds none of the three.
export type AppRole = 'student' | 'instructor' | 'admin'

export interface AdminUser {
  id: string
  username: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  enabled: boolean
  role: AppRole | null
  roles: string[]
  created_at: string | null
}

// users_router.CreateUserRequest (extra="forbid": send exactly these keys).
export interface CreateUserInput {
  username: string
  email?: string
  first_name?: string
  last_name?: string
  role: AppRole
  password: string
  temporary_password: boolean
}

// audit_router.admin_list_audit_log — one audit_log row. `student_id` is the
// target account (users) or pod owner (force-destroy); the acting Admin is
// recorded in `detail` as "actor=<username>".
export interface AuditEvent {
  id: number
  event_type: string
  student_id: string | null
  pod_id: number | null
  vmid: string | null
  result: string | null
  detail: string | null
  timestamp: string
}

export interface AuditLogPage {
  events: AuditEvent[]
  next_before_id: number | null
  event_types: string[]
}

// Student-visible review case: GET /reviews/{id} returns the full row, minus
// SCORING_CONFLICT cases, which the backend never shows a student.
export type StudentReviewCase = ReviewCase

// Provisioning API
export const provisioning = {
  health: async () => {
    const response = await apiClient.get('/health')
    return response.data
  },

  provision: async (studentId: string, scenarioId: string): Promise<ProvisionResponse> => {
    const response = await apiClient.post('/pods/provision', {
      student_id: studentId,
      scenario_id: scenarioId,
    })
    return response.data
  },

  getPod: async (podId: number): Promise<Pod> => {
    const response = await apiClient.get(`/pods/${podId}/status`)
    return response.data
  },

  // count is not part of the real GET /pods contract -- only the offline
  // apiProxy fallback ({pods: [], count: 0}) includes it (handoff doc §3).
  listPods: async (): Promise<{ pods: Pod[]; count?: number }> => {
    const response = await apiClient.get('/pods')
    return response.data
  },

  destroyPod: async (podId: number): Promise<{ status: string }> => {
    const response = await apiClient.delete(`/pods/${podId}/destroy`)
    return response.data
  },

  getGuacToken: async (podId: number): Promise<{ token: string; connection_id: number }> => {
    const response = await apiClient.get(`/pods/${podId}/guac-token`)
    return response.data
  },

  verifyMilestone: async (podId: number, scenarioId: string, milestoneId: number): Promise<{ 
    status: string; 
    message: string; 
    detection_score?: number; 
    alerts_found?: any[]
    detection_data?: string
  }> => {
    const response = await apiClient.post(
      `/pods/${podId}/verify/${scenarioId}/${milestoneId}`,
      undefined,
      // ssh_verifier waits timeout+5 (35s for scenario >= 9). Default 30s axios
      // aborts while the server still records PASS.
      { timeout: 45000 },
    )
    return response.data
  },

  getMilestones: async (podId: number): Promise<{ milestones: { scenario_id: number | string, milestone_id: number, status: string, detection_score?: number, verified_at?: string }[] }> => {
    const response = await apiClient.get(`/pods/${podId}/milestones`)
    return response.data
  },

  getProgress: async (): Promise<{
    student_id: string
    milestones: {
      pod_id: number
      scenario_id: number
      milestone_id: number
      status: string
      detection_score?: number
      verified_at?: string
    }[]
  }> => {
    const response = await apiClient.get('/progress')
    return response.data
  },

  // "Try Again" reset. Permanently deletes this student's milestone_verification
  // rows for the scenario -- irreversible, so the caller (ScenarioInfoView) must
  // confirm with the student before calling this.
  resetScenarioProgress: async (scenarioId: number): Promise<{
    student_id: string
    scenario_id: number
    deleted: number
  }> => {
    const response = await apiClient.delete(`/progress/${scenarioId}`)
    return response.data
  },

  submitFlag: async (
    scenarioId: number,
    data: { milestone_id: number; flag: string }
  ): Promise<{
    outcome: "PASS" | "ESCALATED" | "INCOMPLETE"
    status: string
    scenario_id: number
    milestone_id: number
    message: string
    review_id?: number
    verified_at?: string
    rubric_criteria?: string
  }> => {
    const response = await apiClient.post(`/progress/${scenarioId}/flag`, data)
    return response.data
  },

  getScenarioRubrics: async (
    scenarioId: number
  ): Promise<{
    scenario_id: number
    rubrics: {
      scenario_id: number
      milestone_id: number
      name: string
      criteria: string
      points: number
      mitre_technique?: string
      nist_phase?: string
    }[]
  }> => {
    const response = await apiClient.get(`/progress/${scenarioId}/rubrics`)
    return response.data
  },

  getLabUrls: async (podId: number): Promise<{
    pod_id: number
    student_id: string
    dvwa: {
      ready: boolean
      url: string
      proxy_port?: number
      login?: string
      note?: string
      probe?: number | string
    }
    siem: {
      ready: boolean
      url: string | null
      hint?: string
      manager?: string
    }
  }> => {
    const response = await apiClient.get(`/pods/${podId}/lab-urls`)
    return response.data
  },

  getAlerts: async (
    podId: number,
    query?: { limit?: number; since_minutes?: number; rule_id?: string }
  ): Promise<{
    pod_id: number
    alerts: SiemAlert[]
    total_count: number
    query_window_minutes: number
    error?: string
  }> => {
    const response = await apiClient.get(`/pods/${podId}/alerts`, { params: query })
    return response.data
  },
}

// Instructor/Admin API — dashboard, students list, student progress detail.
// Backed by GET /instructor/students[/{id}] (auth.require_role(["instructor","admin"])).
// Instructor SIEM history (GET /instructor/students/{id}/labs ...).
export interface InstructorLab {
  pod_id: number
  scenario_id: string
  started_at: string
  /** null while the lab is still running */
  ended_at: string | null
  active: boolean
  /** true for labs from before end times were recorded (estimated window) */
  end_estimated: boolean
}

export interface InstructorLabAlerts {
  lab: InstructorLab
  alerts: SiemAlert[]
  total_count: number
  truncated?: boolean
  error?: string
}

export interface ReviewAlertSnapshot {
  review_id: number
  pod_id: number | null
  window_start: string | null
  window_end: string | null
  end_estimated: boolean
  total_count: number
  alerts: SiemAlert[]
  error: string | null
  captured_at: string
}

export const instructor = {
  listStudentLabs: async (studentId: string): Promise<{ student_id: string; labs: InstructorLab[] }> => {
    const response = await apiClient.get(`/instructor/students/${encodeURIComponent(studentId)}/labs`)
    return response.data
  },

  getLabAlerts: async (studentId: string, podId: number, startedAt: string): Promise<InstructorLabAlerts> => {
    const response = await apiClient.get(
      `/instructor/students/${encodeURIComponent(studentId)}/labs/${podId}/alerts`,
      { params: { started_at: startedAt } }
    )
    return response.data
  },

  getReviewAlertSnapshot: async (reviewId: number | string): Promise<{ snapshot: ReviewAlertSnapshot | null }> => {
    const response = await apiClient.get(`/instructor/reviews/${reviewId}/alert-snapshot`)
    return response.data
  },

  // Read-only SIEM view of any student's ACTIVE pod (SIEM audit gap 6).
  // Same response shape and allowlisted fields as provisioning.getAlerts.
  getPodAlerts: async (
    podId: number,
    query?: { limit?: number; since_minutes?: number; rule_id?: string }
  ): Promise<{
    pod_id: number
    alerts: SiemAlert[]
    total_count: number
    query_window_minutes: number
    error?: string
  }> => {
    const response = await apiClient.get(`/instructor/pods/${podId}/alerts`, { params: query })
    return response.data
  },
  listStudents: async (): Promise<{ students: InstructorStudentSummary[] }> => {
    const response = await apiClient.get('/instructor/students')
    return response.data
  },

  getStudentProgress: async (studentId: string): Promise<InstructorStudentDetail> => {
    const response = await apiClient.get(`/instructor/students/${encodeURIComponent(studentId)}`)
    return response.data
  },

  listReviews: async (statusFilter?: string): Promise<{ reviews: ReviewCase[] }> => {
    const params = statusFilter ? { status_filter: statusFilter } : undefined
    const response = await apiClient.get('/instructor/reviews', { params })
    return response.data
  },

  getReview: async (reviewId: number | string): Promise<ReviewCase> => {
    const response = await apiClient.get(`/instructor/reviews/${encodeURIComponent(String(reviewId))}`)
    return response.data
  },

  resolveReview: async (
    reviewId: number | string,
    data: {
      status: 'APPROVED' | 'REJECTED' | 'RETRY'
      score?: number | null
      feedback?: string | null
      expected_status?: string | null
    }
  ): Promise<{ status: string; review_id: number; decision: string }> => {
    const response = await apiClient.post(
      `/instructor/reviews/${encodeURIComponent(String(reviewId))}/resolve`,
      data
    )
    return response.data
  },

  // GAP-02: live student pods + milestone history.
  listPods: async (): Promise<{ pods: InstructorPodWithProgress[] }> => {
    const response = await apiClient.get('/instructor/pods')
    return response.data
  },

  // SCORE-02 / PAPER-16. Fetched as a Blob (not a plain link) so a 503 —
  // e.g. TELEMETRY_ANONYMIZATION_SALT missing for an anonymized export — is
  // reported as an error instead of being saved to disk as the "export".
  exportKnowledgeGain: async (opts: {
    format: 'csv' | 'json'
    anonymize: boolean
    scenarioId?: number
  }): Promise<Blob> => {
    const params: Record<string, string> = {
      format: opts.format,
      anonymize: String(opts.anonymize),
    }
    if (opts.scenarioId) params.scenario_id = String(opts.scenarioId)
    try {
      const response = await apiClient.get('/instructor/export/knowledge-gain', {
        params,
        responseType: 'blob',
      })
      return response.data as Blob
    } catch (err) {
      // With responseType 'blob' an error body is a Blob too; decode it so
      // backendDetail() can read FastAPI's JSON {detail}.
      const e = err as { response?: { data?: unknown } }
      if (e.response?.data instanceof Blob) {
        try {
          e.response.data = JSON.parse(await e.response.data.text())
        } catch {
          // Not JSON — leave the Blob; callers fall back to a generic message.
        }
      }
      throw err
    }
  },
}

// A screenshot attached to a review case (GET /reviews/{id}/images).
export interface EvidenceImage {
  id: number
  review_id: number
  original_name: string | null
  content_type: string
  byte_size: number
  width: number | null
  height: number | null
  caption: string | null
  created_at: string
}

// Student review requests — the student half of SCORE-HYBRID/INST (the
// instructor half is `instructor.listReviews/getReview/resolveReview`).
export const reviews = {
  // MANUAL_REVIEW asks an instructor to look at one milestone; the backend
  // requires conflict_reason or report_text. Student identity comes from the
  // token server-side, never from this body.
  submit: async (data: {
    scenario_id: number
    milestone_id?: number | null
    case_type: 'MANUAL_REVIEW' | 'WRITTEN_REPORT'
    report_text?: string | null
    conflict_reason?: string | null
    evidence_data?: string | null
  }): Promise<{ status: string; review_id: number }> => {
    const response = await apiClient.post('/reviews/submit', data)
    return response.data
  },

  get: async (reviewId: number): Promise<StudentReviewCase> => {
    const response = await apiClient.get(`/reviews/${encodeURIComponent(String(reviewId))}`)
    return response.data
  },

  // Evidence screenshots. The backend re-validates and strips metadata; the
  // caller should shrink big images first (lib/imageCompress) because the
  // origin proxy caps request bodies at 1 MB.
  listImages: async (reviewId: number): Promise<{ review_id: number; images: EvidenceImage[] }> => {
    const response = await apiClient.get(`/reviews/${encodeURIComponent(String(reviewId))}/images`)
    return response.data
  },

  uploadImage: async (reviewId: number, file: Blob, filename: string): Promise<EvidenceImage> => {
    const form = new FormData()
    form.append('file', file, filename)
    const response = await apiClient.post(`/reviews/${encodeURIComponent(String(reviewId))}/images`, form)
    return response.data
  },

  deleteImage: async (reviewId: number, imageId: number): Promise<void> => {
    await apiClient.delete(
      `/reviews/${encodeURIComponent(String(reviewId))}/images/${encodeURIComponent(String(imageId))}`
    )
  },

  /** Same-origin URL for an <img src>; the BFF adds the session's token. */
  imageUrl: (reviewId: number, imageId: number): string =>
    `${API_BASE}/reviews/${encodeURIComponent(String(reviewId))}/images/${encodeURIComponent(String(imageId))}`,

  // Only for cases an instructor returned with RETRY.
  resubmit: async (
    reviewId: number,
    data: { report_text?: string | null; conflict_reason?: string | null; evidence_data?: string | null }
  ): Promise<{ status: string; review_id: number }> => {
    const response = await apiClient.post(`/reviews/${encodeURIComponent(String(reviewId))}/resubmit`, data)
    return response.data
  },
}

// ADM-UI #31 — Admin pods list/detail/force-destroy + capacity.
// GET /pods and GET /pods/{id}/status are the SAME backend routes Students poll;
// the backend widens the result set by caller role, so listPods/getPod are
// reused as-is (handoff doc §2). Only force-destroy and capacity are genuinely
// admin-only routes needing their own proxy.
export const admin = {
  listPods: provisioning.listPods,
  getPod: provisioning.getPod,

  // 200 means accepted/scheduled, not torn down -- poll getPod(podId) until
  // status === "DESTROYED". Never treat a 404 from that poll as completion
  // (handoff doc §5) -- it just means the pod row/proxy lookup failed.
  forceDestroyPod: async (podId: number): Promise<{ status: string; pod_id: number }> => {
    const response = await apiClient.delete(`/admin/pods/${podId}/force-destroy`)
    return response.data
  },

  getCapacity: async (): Promise<Capacity> => {
    const response = await apiClient.get('/capacity')
    return response.data
  },

  getInfraHealth: async (): Promise<InfraHealth> => {
    const response = await apiClient.get('/admin/infra-health')
    return response.data
  },

  // ADM-USER (#32 / PR #88) — Keycloak-backed user management.
  listUsers: async (search?: string): Promise<{ users: AdminUser[] }> => {
    const params: Record<string, string> = { max: '200' }
    if (search?.trim()) params.search = search.trim()
    const response = await apiClient.get('/admin/users', { params })
    return response.data
  },

  createUser: async (data: CreateUserInput): Promise<AdminUser> => {
    const response = await apiClient.post('/admin/users', data)
    return response.data
  },

  // Disabling also ends the user's sessions (backend logout + cache revoke).
  setUserEnabled: async (userId: string, enabled: boolean): Promise<AdminUser> => {
    const response = await apiClient.patch(`/admin/users/${encodeURIComponent(userId)}/enabled`, { enabled })
    return response.data
  },

  // A real role change ends the user's sessions so it applies at next sign-in.
  setUserRole: async (userId: string, role: AppRole): Promise<AdminUser> => {
    const response = await apiClient.put(`/admin/users/${encodeURIComponent(userId)}/role`, { role })
    return response.data
  },

  // Also ends the user's sessions. `temporary` = forced change at next sign-in.
  resetUserPassword: async (userId: string, password: string, temporary: boolean): Promise<AdminUser> => {
    const response = await apiClient.put(`/admin/users/${encodeURIComponent(userId)}/password`, {
      password,
      temporary,
    })
    return response.data
  },

  // Read-only audit trail, newest first; page with next_before_id.
  listAuditLog: async (filters: {
    eventType?: string
    studentId?: string
    result?: string
    beforeId?: number
    limit?: number
  } = {}): Promise<AuditLogPage> => {
    const params: Record<string, string> = { limit: String(filters.limit ?? 100) }
    if (filters.eventType) params.event_type = filters.eventType
    if (filters.studentId?.trim()) params.student_id = filters.studentId.trim()
    if (filters.result) params.result = filters.result
    if (filters.beforeId) params.before_id = String(filters.beforeId)
    const response = await apiClient.get('/admin/audit-log', { params })
    return response.data
  },
}

// Unused. No /score routes on the provision API. Live verify is
// provisioning.verifyMilestone → /pods/{id}/verify/…
export const scoring = {
  getScenarios: async (): Promise<Scenario[]> => {
    const response = await scoringClient.get('/score/scenarios')
    return response.data
  },

  verifyMilestone: async (milestone: string, podId: number): Promise<{ completed: boolean; points: number; message: string }> => {
    const response = await scoringClient.post(`/score/verify/${milestone}`, {
      pod_id: podId,
    })
    return response.data
  },

  getPodScore: async (podId: number): Promise<Score> => {
    const response = await scoringClient.get(`/score/pod/${podId}`)
    return response.data
  },
}

// Legacy compatibility
export const api = {
  provisionPod: (studentId: string, scenarioId: string) => provisioning.provision(studentId, scenarioId),
  getPodStatus: (podId: string) => provisioning.getPod(parseInt(podId)),
  destroyPod: (podId: string) => provisioning.destroyPod(parseInt(podId)),
  listPods: () => provisioning.listPods(),
  verifyMilestone: (milestoneId: string, podId: string) => scoring.verifyMilestone(milestoneId, parseInt(podId)),
  getScenarios: () => scoring.getScenarios(),
  getPodScore: (podId: string) => scoring.getPodScore(parseInt(podId)),
}
