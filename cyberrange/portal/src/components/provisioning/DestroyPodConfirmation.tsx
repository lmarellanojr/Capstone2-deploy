"use client";

import { useState } from "react";
import { mapErrorToMessage } from "@/lib/errorHandler";
import { useToastContext } from "@/context/ToastContext";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface DestroyPodConfirmationProps {
  podId: number;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function DestroyPodConfirmation({
  podId,
  isOpen,
  onCancel,
  onConfirm,
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
      <ModalHeader title="Destroy Pod" onClose={handleCancel} />
      <ModalBody>
        <div className="space-y-4">
          <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg">
            <p className="text-sm font-semibold text-danger mb-2">Warning</p>
            <p className="text-sm text-text-main">
              You are about to permanently destroy <strong>Pod {podId}</strong>. This action cannot be undone.
              All data and running services in this pod will be lost.
            </p>
          </div>
          {error && (
            <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={handleConfirm}
          loading={loading}
          disabled={loading}
        >
          Destroy Pod
        </Button>
      </ModalFooter>
    </Modal>
  );
}
