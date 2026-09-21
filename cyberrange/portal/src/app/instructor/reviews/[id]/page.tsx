"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import {
  AccessDenied,
  Badge,
  Button,
  LoadingSpinner,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/components/ui";
import { instructorNavItems } from "@/lib/navigation";
import { instructor, InstructorMilestone, ReviewCase } from "@/lib/api";
import { parseEvidenceData } from "@/lib/evidenceParser";
import { mapErrorToMessage, isForbiddenError } from "@/lib/errorHandler";
import { useToastContext } from "@/context/ToastContext";
import { formatScenarioName, formatMilestoneLabel } from "@/lib/scenarioLabels";
import { validateScore, resolveScorePayload } from "@/lib/scoreEvaluation";
import { selectVerifierAttempts } from "@/lib/verifierEvidence";

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "info"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  RETRY: "info",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  retry: "info",
};

function verifierBadgeVariant(status: string): "success" | "danger" | "warning" {
  const s = status.toUpperCase();
  if (s === "PASS") return "success";
  if (s === "FAIL") return "danger";
  return "warning";
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime())
      ? dateStr
      : d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  } catch {
    return dateStr;
  }
}

export default function ReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const { success, error: showToastError } = useToastContext();

  const [reviewCase, setReviewCase] = useState<ReviewCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Evaluation Form State
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState<number | string>("");

  // Confirmation Modal State
  const [confirmDecision, setConfirmDecision] = useState<"APPROVED" | "REJECTED" | "RETRY" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Automated verifier evidence, correlated read-only from the student's
  // milestone_verification history (handoff §2.4). Loaded separately so a
  // failure here never blocks reviewing the case itself.
  const [verifierMilestones, setVerifierMilestones] = useState<InstructorMilestone[] | null>(null);
  const [verifierLoading, setVerifierLoading] = useState(false);
  const [verifierError, setVerifierError] = useState<string | null>(null);
  const [verifierAttempt, setVerifierAttempt] = useState(0);

  const fetchReview = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    try {
      const data = await instructor.getReview(params.id);
      setReviewCase(data);
      if (data.feedback) setFeedback(data.feedback);
      if (data.score !== null && data.score !== undefined) setScore(data.score);
      setError(null);
      setForbidden(false);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (isForbiddenError(err)) {
        setForbidden(true);
        setError(null);
      } else if (status === 404) {
        setReviewCase(null);
        setError(null);
        setForbidden(false);
      } else {
        setForbidden(false);
        setError(mapErrorToMessage(err).message);
      }
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void fetchReview();
  }, [fetchReview]);

  const studentId = reviewCase?.student_id;
  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setVerifierLoading(true);
    setVerifierError(null);
    instructor
      .getStudentProgress(studentId)
      .then((detail) => {
        if (!cancelled) setVerifierMilestones(detail.milestones);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVerifierMilestones(null);
        setVerifierError(mapErrorToMessage(err).message);
      })
      .finally(() => {
        if (!cancelled) setVerifierLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, verifierAttempt]);

  const verifierAttempts =
    reviewCase && verifierMilestones
      ? selectVerifierAttempts(verifierMilestones, reviewCase.scenario_id, reviewCase.milestone_id)
      : [];

  const handleOpenConfirm = (decision: "APPROVED" | "REJECTED" | "RETRY") => {
    const validation = validateScore(decision, score);
    if (!validation.valid) {
      showToastError(validation.error || "Invalid score entered.");
      return;
    }
    setConfirmDecision(decision);
  };

  const handleExecuteResolution = async () => {
    if (!reviewCase || !confirmDecision) return;
    setIsSubmitting(true);
    try {
      const { score: numericScore } = resolveScorePayload(confirmDecision, score);

      const res = await instructor.resolveReview(reviewCase.review_id, {
        status: confirmDecision,
        score: numericScore,
        feedback: feedback.trim() || null,
      });

      success(`Review case #${reviewCase.review_id} resolved: ${res.decision || confirmDecision}`);
      setConfirmDecision(null);
      await fetchReview();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        showToastError("Review case or resolve endpoint not found.");
      } else {
        showToastError(mapErrorToMessage(err).message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (forbidden) {
    return (
      <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
        <AccessDenied message="You need an instructor or admin role to view review case details." />
      </LayoutWrapper>
    );
  }

  return (
    <LayoutWrapper navItems={instructorNavItems} sectionLabel="Instructor" hideSearch>
      <div className="mb-6">
        <Link href="/instructor/reviews" className="text-sm text-brand font-semibold hover:underline">
          ← Back to Review Queue
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner message="Loading review details..." />
        </div>
      ) : error ? (
        <div className="card-surface p-10 text-center">
          <p className="text-danger font-semibold mb-2">Review Case Unavailable</p>
          <p className="text-text-muted text-sm mb-4">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void fetchReview()}>
            Retry
          </Button>
        </div>
      ) : !reviewCase ? (
        <div className="card-surface p-10 text-center">
          <p className="text-lg font-semibold text-text-main mb-1">Review case not found</p>
          <p className="text-text-muted text-sm">
            Case #{params.id} does not exist in the database.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-text-main font-mono">
                  #{reviewCase.review_id}
                </h1>
                <Badge variant={STATUS_BADGE[reviewCase.status.toUpperCase()] || "default"}>
                  {reviewCase.status}
                </Badge>
              </div>
              <p className="text-text-muted mt-1 text-sm">
                Student <span className="font-semibold text-text-main">{reviewCase.student_id}</span> ·{" "}
                {formatScenarioName(reviewCase.scenario_id)} · {formatMilestoneLabel(reviewCase.milestone_id)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Milestone Attempt & Report */}
              <div className="card-surface p-6">
                <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
                  <h2 className="text-lg font-bold text-text-main">Milestone Attempt</h2>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted text-text-muted">
                    {reviewCase.case_type}
                  </span>
                </div>

                {reviewCase.report_text ? (
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                      Submitted Report Text
                    </h3>
                    <p className="text-sm text-text-main whitespace-pre-wrap bg-muted/40 p-3 rounded-lg border border-border">
                      {reviewCase.report_text}
                    </p>
                  </div>
                ) : null}

                {reviewCase.conflict_reason ? (
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold text-danger uppercase tracking-wider mb-1">
                      Reported Conflict Reason
                    </h3>
                    <p className="text-sm text-text-main bg-danger/10 p-3 rounded-lg border border-danger/30">
                      {reviewCase.conflict_reason}
                    </p>
                  </div>
                ) : null}

                {!reviewCase.report_text && !reviewCase.conflict_reason && (
                  <p className="text-sm text-text-muted italic">
                    No written report or conflict text was provided with this submission.
                  </p>
                )}
              </div>

              {/* Evidence Section */}
              <div className="card-surface p-6">
                <h2 className="text-lg font-bold text-text-main mb-3">Student Evidence</h2>
                <div className="rounded-lg overflow-hidden border border-border">
                  <pre className="font-mono text-xs p-4 bg-muted/50 text-text-main overflow-x-auto whitespace-pre-wrap max-h-96">
                    {parseEvidenceData(reviewCase.evidence_data)}
                  </pre>
                </div>
              </div>

              {/* Automated Verifier Evidence */}
              <div className="card-surface p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-bold text-text-main">Automated Verifier Evidence</h2>
                  <span className="text-xs text-text-muted">
                    {formatScenarioName(reviewCase.scenario_id)} · {formatMilestoneLabel(reviewCase.milestone_id)}
                  </span>
                </div>

                {verifierLoading ? (
                  <LoadingSpinner message="Loading verifier results..." />
                ) : verifierError ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <p className="text-danger">Could not load verifier results: {verifierError}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setVerifierAttempt((n) => n + 1)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : verifierAttempts.length === 0 ? (
                  <p className="text-sm text-text-muted italic">
                    No automated verification attempts recorded for this{" "}
                    {reviewCase.milestone_id === null ? "scenario" : "milestone"}.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-text-muted border-b border-border">
                          <th className="py-2 px-3 font-semibold">Milestone</th>
                          <th className="py-2 px-3 font-semibold">Result</th>
                          <th className="py-2 px-3 font-semibold">Detection Score</th>
                          <th className="py-2 px-3 font-semibold">Verified</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verifierAttempts.map((m, idx) => (
                          <tr
                            key={`${m.milestone_id}-${m.verified_at ?? idx}-${idx}`}
                            className="border-b border-border last:border-0"
                          >
                            <td className="py-2 px-3 text-text-main">{m.milestone_id}</td>
                            <td className="py-2 px-3">
                              <Badge variant={verifierBadgeVariant(m.status)}>{m.status}</Badge>
                            </td>
                            <td className="py-2 px-3 font-mono text-text-main">
                              {m.detection_score ?? "-"}
                            </td>
                            <td className="py-2 px-3 text-text-muted">{formatDate(m.verified_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Resolution History (if already resolved) */}
              {reviewCase.status.toUpperCase() !== "PENDING" && (
                <div className="card-surface p-6 border-l-4 border-brand">
                  <h2 className="text-lg font-bold text-text-main mb-2">Previous Resolution</h2>
                  <div className="text-sm space-y-1 text-text-muted">
                    <p>
                      <strong className="text-text-main">Decision:</strong> {reviewCase.status}
                    </p>
                    {reviewCase.score !== null && (
                      <p>
                        <strong className="text-text-main">Score:</strong> {reviewCase.score} / 100
                      </p>
                    )}
                    {reviewCase.graded_by && (
                      <p>
                        <strong className="text-text-main">Evaluated By:</strong> {reviewCase.graded_by}
                      </p>
                    )}
                    <p>
                      <strong className="text-text-main">Evaluated At:</strong>{" "}
                      {formatDate(reviewCase.updated_at)}
                    </p>
                    {reviewCase.feedback && (
                      <p className="mt-2 bg-muted/30 p-3 rounded text-text-main">
                        <strong className="text-text-muted block text-xs mb-1">Feedback given:</strong>
                        {reviewCase.feedback}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Evaluation Actions Panel */}
            <div className="space-y-6">
              <div className="card-surface p-6">
                <h2 className="text-lg font-bold text-text-main mb-4">Instructor Evaluation</h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">
                      Assigned Score (0 - 100)
                    </label>
                    <input
                      type="number"
                      step={1}
                      min={0}
                      max={100}
                      value={score}
                      onChange={(e) => setScore(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:outline-none focus:border-brand"
                      placeholder="e.g. 100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">
                      Evaluation Feedback / Notes
                    </label>
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="Enter constructive feedback or rationale for the student..."
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-text-main placeholder-text-muted resize-none focus:outline-none focus:border-brand"
                      rows={5}
                    />
                  </div>

                  <div className="pt-2 space-y-2">
                    <Button
                      variant="success"
                      className="w-full"
                      onClick={() => handleOpenConfirm("APPROVED")}
                    >
                      ✓ Approve Submission
                    </Button>
                    <Button
                      variant="danger"
                      className="w-full"
                      onClick={() => handleOpenConfirm("REJECTED")}
                    >
                      ✕ Reject Submission
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleOpenConfirm("RETRY")}
                    >
                      ↺ Request Student Retry
                    </Button>
                  </div>
                </div>
              </div>

              {/* Case Metadata Card */}
              <div className="card-surface p-6 text-xs space-y-2 text-text-muted">
                <h3 className="font-semibold text-text-main uppercase text-xs mb-3">Case Metadata</h3>
                <div className="flex justify-between">
                  <span>Created:</span>
                  <span className="font-mono text-text-main">{formatDate(reviewCase.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last Updated:</span>
                  <span className="font-mono text-text-main">{formatDate(reviewCase.updated_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Scenario ID:</span>
                  <span className="font-mono text-text-main">{reviewCase.scenario_id}</span>
                </div>
                <div className="flex justify-between">
                  <span>Milestone ID:</span>
                  <span className="font-mono text-text-main">{reviewCase.milestone_id ?? "N/A"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Confirmation Modal */}
          <Modal
            isOpen={confirmDecision !== null}
            onClose={() => {
              if (!isSubmitting) setConfirmDecision(null);
            }}
          >
            <ModalHeader
              title={`Confirm Decision: ${confirmDecision}`}
              onClose={() => {
                if (!isSubmitting) setConfirmDecision(null);
              }}
            />
            <ModalBody>
              <div className="space-y-4 text-sm text-text-main">
                <p>
                  You are about to resolve Review Case{" "}
                  <span className="font-mono font-semibold">#{reviewCase.review_id}</span> for student{" "}
                  <span className="font-semibold">{reviewCase.student_id}</span> as:
                </p>

                {reviewCase.status.toUpperCase() !== "PENDING" && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs">
                    <strong>Notice:</strong> This case is currently{" "}
                    <span className="font-semibold">{reviewCase.status}</span>
                    {reviewCase.graded_by ? ` (evaluated by ${reviewCase.graded_by})` : ""}. Saving will replace the previous evaluation.
                  </div>
                )}

                <div className="p-4 rounded-lg bg-muted/40 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">Decision:</span>
                    <Badge variant={confirmDecision ? STATUS_BADGE[confirmDecision] : "default"}>
                      {confirmDecision}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">Assigned Score:</span>
                    <span className="font-semibold font-mono">
                      {confirmDecision ? resolveScorePayload(confirmDecision, score).display : "None"}
                    </span>
                  </div>
                  {feedback.trim() && (
                    <div className="pt-2 border-t border-border">
                      <span className="text-text-muted block text-xs mb-1">Feedback:</span>
                      <p className="text-xs bg-muted/60 p-2 rounded whitespace-pre-wrap">
                        {feedback.trim()}
                      </p>
                    </div>
                  )}
                </div>

                <p className="text-xs text-text-muted">
                  This action will persist to the review database and update the student&apos;s progress status.
                </p>
              </div>
            </ModalBody>
            <ModalFooter>
              <div className="flex justify-end gap-3 w-full">
                <Button
                  variant="secondary"
                  disabled={isSubmitting}
                  onClick={() => setConfirmDecision(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant={
                    confirmDecision === "APPROVED"
                      ? "success"
                      : confirmDecision === "REJECTED"
                      ? "danger"
                      : "primary"
                  }
                  disabled={isSubmitting}
                  onClick={() => void handleExecuteResolution()}
                >
                  {isSubmitting ? "Submitting..." : "Confirm & Save Decision"}
                </Button>
              </div>
            </ModalFooter>
          </Modal>
        </>
      )}
    </LayoutWrapper>
  );
}
