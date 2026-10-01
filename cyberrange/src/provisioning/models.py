"""Pydantic request/response models."""
from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field

# student_id is embedded unvalidated into LXD instance names
# (pod-{student_id}-kali/meta/dvwa), cloud-config content, /etc/sudoers.d
# filenames, and Wazuh agent names. LXD instance names are themselves
# restricted, so an unvalidated value can fail container creation with a
# confusing LXD error, or worse, land inside cloud-config/sudoers content
# built via plain string interpolation (branch-review Issue 10). Keycloak's
# preferred_username is not guaranteed to match this pattern for every IdP
# configuration, but every deployment this API currently targets does.
STUDENT_ID_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,31}$"


class ProvisionRequest(BaseModel):
    student_id: str = Field(..., pattern=STUDENT_ID_PATTERN)
    scenario_id: str = "01"


class PodResponse(BaseModel):
    pod_id: int
    student_id: str
    status: str
    vmid_kali: Optional[str]
    vmid_meta: Optional[str]
    vmid_dvwa: Optional[str]
    connection_id: Optional[int]
    wazuh_agent_id: Optional[str]
    last_heartbeat: Optional[str]
    scenario_id: Optional[str] = None
    created_at: Optional[str] = None
    ttl_hours: int
    remaining_seconds: int
    expires_at: Optional[str] = None
    ttl_expired: bool


class VerificationRequest(BaseModel):
    scenario_id: int
    milestone_id: int


class VerificationResponse(BaseModel):
    # REVIEW = the student's one Manual Check was already used and did not pass,
    # so the task is locked to instructor review (G1 one-shot Manual Check).
    status: Literal["PASS", "FAIL", "ERROR", "UNKNOWN", "REVIEW"]
    message: str
    pod_id: int
    scenario_id: int
    milestone_id: int
    verified_at: str
    detection_score: Optional[int] = 0
    alerts_found: Optional[List[dict]] = []


class MilestoneResult(BaseModel):
    scenario_id: int
    milestone_id: int
    status: Literal["PASS", "FAIL", "ERROR", "UNKNOWN"]
    verified_at: str
    detection_score: Optional[int] = 0


class ReviewResolveRequest(BaseModel):
    status: str
    score: Optional[int] = None
    feedback: Optional[str] = None
    expected_status: Optional[str] = None


class ReviewResolveResponse(BaseModel):
    status: str
    review_id: int
    decision: str


class ReviewResubmitRequest(BaseModel):
    report_text: Optional[str] = None
    conflict_reason: Optional[str] = None
    evidence_data: Optional[Union[str, dict, list]] = None


class ReviewResubmitResponse(BaseModel):
    status: str
    review_id: int


class KnowledgeGainRecord(BaseModel):
    student_id: str
    scenario_id: int
    milestone_id: int
    status: Literal["PASS", "FAIL", "ERROR", "UNKNOWN"]
    verified_at: str
    detection_score: Optional[int] = 0
    time_to_milestone_seconds: Optional[float] = None
    rubric_score: Optional[int] = None
    scenario_rubric_score: Optional[int] = None


class KnowledgeGainSummary(BaseModel):
    total_records: int
    total_passes: int
    distinct_milestones_attempted: int
    distinct_milestones_passed: int
    completion_rate: float
    attempt_pass_rate: Optional[float] = Field(
        None,
        description="Raw verification-row pass ratio (total_passes / total_records), reflecting attempt frequency including poller ticks",
    )
    avg_time_to_milestone_seconds: Optional[float] = None
    avg_detection_score: Optional[float] = Field(
        None,
        description="Mean detection score across distinct completed milestones, evaluated from each milestone's first PASS row",
    )


class KnowledgeGainExportResponse(BaseModel):
    summary: KnowledgeGainSummary
    records: List[KnowledgeGainRecord]



class FlagSubmissionRequest(BaseModel):
    milestone_id: int = Field(..., ge=1, le=10)
    flag: str = Field(..., min_length=1, max_length=256)


class FlagSubmissionResponse(BaseModel):
    outcome: Literal["PASS", "ESCALATED", "INCOMPLETE"]
    status: str
    scenario_id: int
    milestone_id: int
    message: str
    review_id: Optional[int] = None
    verified_at: Optional[str] = None
    rubric_criteria: Optional[str] = None


class MilestoneRubricResponse(BaseModel):
    scenario_id: int
    milestone_id: int
    name: str
    criteria: str
    points: int
    mitre_technique: Optional[str] = None
    nist_phase: Optional[str] = None


class ScenarioRubricsResponse(BaseModel):
    scenario_id: int
    rubrics: List[MilestoneRubricResponse]
