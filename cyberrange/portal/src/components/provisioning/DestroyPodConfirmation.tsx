"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { mapErrorToMessage } from "@/lib/errorHandler";
import { useToastContext } from "@/context/ToastContext";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface DestroyPodConfirmationProps {
  podId: number;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  /** Student wording: "end your lab session" rather than "destroy pod N".
   *  `labLabel` names the lab (e.g. "Scenario 1 — Network Reconnaissance"). */
  studentFacing?: boolean;
  labLabel?: string;
}

export function DestroyPodConfirmation({
  podId,
  isOpen,
  onCancel,
  onConfirm,
  studentFacing = false,
  labLabel,
}: DestroyPodConfirmationProps) {
  const { error: showError } = useToastContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
      // Success callback will handle closing
    } catch (err) {
      // Use error handler to map to user-friendly message
      const { message } = mapErrorToMessage(err);
      setError(message);
      showError(message, 4000);
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    setLoading(false);
    onCancel();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel}>
      <ModalHeader title={studentFacing ? "End this lab session?" : "Destroy Pod"} onClose={handleCancel} />
      <ModalBody>
        <div className="space-y-4">
          <div className="p-4 alert-warning flex gap-3">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
            {studentFacing ? (
              <p className="text-sm">
                This shuts down the lab machines for{" "}
                <strong>{labLabel ?? `lab session ${podId}`}</strong>. Your score is already saved,
                but anything you created inside the lab (files, open shells) will be lost.
              </p>
            ) : (
              <p className="text-sm">
                You are about to permanently destroy <strong>Pod {podId}</strong>. This action cannot be undone.
                All data and running services in this pod will be lost.
              </p>
            )}
          </div>
          {error && (
            <div role="alert" className="p-4 alert-error text-sm">
              {error}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleCancel} disabled={loading}>
          {studentFacing ? "Keep it running" : "Cancel"}
        </Button>
        <Button variant="danger" onClick={handleConfirm} loading={loading} disabled={loading}>
          {studentFacing ? "End session" : "Destroy Pod"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
