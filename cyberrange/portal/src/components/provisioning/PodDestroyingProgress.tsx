"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import { useStatusPoller } from "@/hooks/useStatusPoller";
import { useToastContext } from "@/context/ToastContext";
import { Button } from "@/components/ui";

interface PodDestroyingProgressProps {
  podId: number;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  /** Student dashboard wording ("lab session") instead of the operator
   *  wording ("pod") the Admin pages use. Behavior is identical. */
  studentFacing?: boolean;
}

const COPY = {
  admin: {
    toast: "Pod destroyed successfully!",
    stuckToast:
      "Pod is taking longer than expected to destroy. The system is retrying automatically. Please contact support if this persists.",
    errorTitle: "Unable to check destroy status",
    retry: "Retry Destroy",
    done: "Pod Destroyed",
    working: (status: string) => `Destroying... (${status})`,
    stuck:
      "Pod taking longer than expected. The system is retrying automatically — please contact support if this persists.",
  },
  student: {
    toast: "Lab session ended. Your score is saved.",
    stuckToast:
      "Ending your lab is taking longer than usual. It's retrying automatically — ask your instructor if this persists.",
    errorTitle: "Couldn't confirm the lab has ended",
    retry: "Check again",
    done: "Lab session ended",
    working: () => "Shutting down your lab…",
    stuck:
      "This is taking longer than usual. It's retrying automatically — ask your instructor if this persists.",
  },
};

// How long the success state is shown before calling onComplete (gives the
// user a moment to register that the pod is gone before the card disappears).
const AUTO_COMPLETE_DELAY_MS = 1000;

/**
 * Shows real-time pod destruction progress by polling GET /api/pods/{id}/status
 * (via useStatusPoller, phase='destroy'). Terminal states:
 *  - DESTROYED (either a real DESTROYED status, or the hook's own mapping of
 *    HTTP 404 -> DESTROYED, since a missing pod row means destroy succeeded)
 * Non-terminal DESTROYING that persists past 5 minutes surfaces the hook's
 * stuckDestroyWarning flag as an inline warning (reaper is retrying).
 */
export function PodDestroyingProgress({ podId, onComplete, onError, studentFacing = false }: PodDestroyingProgressProps) {
  const copy = studentFacing ? COPY.student : COPY.admin;
  const { success, error: showError, warning } = useToastContext();
  const { status, error, stuckDestroyWarning, restart } = useStatusPoller(podId, "destroy", {
    onError: (errorMsg: string) => {
      showError(errorMsg, 4000);
    },
  });
  const notifiedErrorRef = useRef(false);
  const completeScheduledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const isDestroyed = status === "DESTROYED";
  const hasError = Boolean(error);

  // Guarded by a ref (not state) so this effect only depends on `isDestroyed`
  // — a fresh `onComplete` identity on re-render must not cancel/reschedule
  // the pending timer.
  useEffect(() => {
    if (!isDestroyed || completeScheduledRef.current) return;
    completeScheduledRef.current = true;
    // Show success toast
    success(copy.toast, AUTO_COMPLETE_DELAY_MS + 500);
    const timer = setTimeout(() => {
      onCompleteRef.current?.();
    }, AUTO_COMPLETE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isDestroyed, success, copy.toast]);

  // Reset the notified-error guard once the error clears (e.g. via restart())
  // so a subsequent failure can notify onError again.
  useEffect(() => {
    if (!hasError) {
      notifiedErrorRef.current = false;
      return;
    }
    if (notifiedErrorRef.current) return;
    notifiedErrorRef.current = true;
    onError?.(new Error(error || "Failed to check destroy status."));
  }, [hasError, error, onError]);

  // Notify about stuck destroy via warning toast
  useEffect(() => {
    if (stuckDestroyWarning) {
      warning(copy.stuckToast, 5000);
    }
  }, [stuckDestroyWarning, warning, copy.stuckToast]);

  if (hasError) {
    return (
      <div role="alert" className="text-center py-6">
        <p className="text-danger font-semibold mb-2">{copy.errorTitle}</p>
        <p className="text-text-muted text-sm mb-4">{error}</p>
        <Button variant="secondary" size="sm" onClick={restart}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  if (isDestroyed) {
    return (
      <div className="text-center py-6">
        <CheckCircle2 size={32} className="mx-auto mb-2 text-success" aria-hidden="true" />
        <p className="font-semibold text-text-main">{copy.done}</p>
      </div>
    );
  }

  return (
    <div className="py-4" data-testid="pod-destroying-progress">
      <p className="font-semibold text-text-main mb-2">{copy.working(status ?? "DESTROYING")}</p>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden" role="progressbar" aria-label={copy.working(status ?? "DESTROYING")}>
        <div className="h-full bg-brand animate-pulse w-full" />
      </div>

      {stuckDestroyWarning && (
        <p role="alert" className="mt-3 text-warning text-sm font-semibold">
          {copy.stuck}
        </p>
      )}
    </div>
  );
}
