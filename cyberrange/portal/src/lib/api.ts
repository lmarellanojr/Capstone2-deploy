import axios from "axios"

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

  getMilestones: async (podId: number): Promise<{ milestones: { scenario_id: string, milestone_id: number, status: string, detection_score?: number, verified_at?: string }[] }> => {
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
export const instructor = {
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
    const response = await apiClient.get(`/instructor/reviews/${reviewId}`)
    return response.data
  },

  resolveReview: async (
    reviewId: number | string,
    data: {
      status: 'APPROVED' | 'REJECTED' | 'RETRY'
      score?: number | null
      feedback?: string | null
    }
  ): Promise<{ status: string; review_id: number; decision: string }> => {
    const response = await apiClient.post(`/instructor/reviews/${reviewId}/resolve`, data)
    return response.data
  },

  listPods: async (): Promise<{ pods: InstructorPod[] }> => {
    const response = await apiClient.get('/instructor/pods')
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
