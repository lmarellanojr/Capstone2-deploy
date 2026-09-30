"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import { useStatusPoller } from "@/hooks/useStatusPoller";
import { useToastContext } from "@/context/ToastContext";
import { Button, LoadingSpinner } from "@/components/ui";

interface PodProvisioningProgressProps {
  podId: number;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

// How long the success state is shown before auto-closing (gives the user
// a moment to register that provisioning finished).
const AUTO_CLOSE_DELAY_MS = 1500;

/**
 * Shows real-time pod creation progress by polling GET /api/pods/{id}/status
 * (via useStatusPoller, phase='create'). Terminal states:
 *  - ACTIVE: success -> auto-closes after a short delay
 *  - FAILED_ROLLBACK_COMPLETE: failure -> shows an alert + stop control
 * Any transport/HTTP error surfaced by the hook (401/409/503/5xx while
 * polling) is displayed with a stop control as well.
 */
export function PodProvisioningProgress({ podId, onComplete, onError }: PodProvisioningProgressProps) {
  const { success, error: showError } = useToastContext();
  const { status, error, stop } = useStatusPoller(podId, "create", {
    onError: (errorMsg: string) => {
      showError(errorMsg, 4000);
    },
  });
  const notifiedErrorRef = useRef(false);
  const closeScheduledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const isActive = status === "ACTIVE";
  const isFailedRollback = status === "FAILED_ROLLBACK_COMPLETE";
  const hasError = Boolean(error);

  // Success terminal: auto-close after a short delay so the user sees confirmation.
  // Scheduling is guarded by a ref (not state) so this effect only depends on
  // `isActive` — re-renders triggered by a fresh `onComplete` identity must not
  // cancel/reschedule the pending timer.
  useEffect(() => {
    if (!isActive || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    // Show success toast
    success("Pod provisioned successfully! Connecting to dashboard...", AUTO_CLOSE_DELAY_MS + 500);
    const timer = setTimeout(() => {
      onCompleteRef.current?.();
    }, AUTO_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isActive, success]);

  // Failure terminal or poll error: notify parent once.
  useEffect(() => {
    if (!(isFailedRollback || hasError) || notifiedErrorRef.current) return;
    notifiedErrorRef.current = true;
    onError?.(new Error(error || "Provisioning failed and the pod was rolled back."));
  }, [isFailedRollback, hasError, error, onError]);

  if (hasError) {
    return (
      <div role="alert" className="text-center py-8">
        <p className="text-danger font-semibold mb-2">Unable to check provisioning status</p>
        <p className="text-text-muted text-sm mb-4">{error}</p>
        <Button variant="secondary" size="sm" onClick={stop}>
          Stop
        </Button>
      </div>
    );
  }

  if (isFailedRollback) {
    return (
      <div role="alert" className="text-center py-8">
        <p className="text-danger font-semibold mb-2">Provisioning Failed</p>
        <p className="text-text-muted text-sm mb-4">
          The pod could not be created and has been rolled back. Please try again.
        </p>
        <Button variant="secondary" size="sm" onClick={stop}>
          Stop
        </Button>
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 size={40} className="mx-auto mb-4 text-success" aria-hidden="true" />
        <h3 className="text-lg font-bold text-text-main mb-2">Active</h3>
        <p className="text-text-muted text-sm">Your pod is ready. Closing...</p>
      </div>
    );
  }

  return (
    <div className="text-center py-8">
      <LoadingSpinner message={`Provisioning... (${status ?? "PROVISIONING"})`} />
      <p className="text-text-muted text-sm mt-4">This may take a few moments...</p>
    </div>
  );
}
