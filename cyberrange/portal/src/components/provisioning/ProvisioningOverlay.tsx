"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { mapErrorToMessage } from "@/lib/errorHandler";
import { Modal, ModalHeader, ModalBody, ModalFooter, Button } from "@/components/ui";
import { StepTracker } from "./StepTracker";
import { PodProvisioningProgress } from "./PodProvisioningProgress";
import { useScenarios } from "@/hooks/useScenarios";
import { useProvisioning } from "@/hooks/useProvisioning";
import { useToastContext } from "@/context/ToastContext";
import type { ProvisionResponse } from "@/lib/api";

interface ProvisioningOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: ProvisionResponse) => void;
}

export function ProvisioningOverlay({ isOpen, onClose, onSubmit }: ProvisioningOverlayProps) {
  const { data: session } = useSession();
  const scenarios = useScenarios();
  const { provision, loading: apiLoading, clearError } = useProvisioning();
  const { success, error: showError } = useToastContext();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [provisionedPodId, setProvisionedPodId] = useState<number | null>(null);
  const [provisionResult, setProvisionResult] = useState<ProvisionResponse | null>(null);

  const stepLabels = ["Select Scenario", "Review", "Deploy"];

  const resetForm = () => {
    setCurrentStep(0);
    setSelectedScenario("");
    setProvisionedPodId(null);
    setProvisionResult(null);
  };

  const handleNext = async () => {
    if (currentStep === 2) {
      try {
        setError(null);
        const studentId = session?.user?.name;
        if (!studentId) {
          throw new Error("Not signed in — please log in again.");
        }
        const result = await provision(studentId, selectedScenario);
        // Don't close the modal here — switch to the polling view so the
        // user can watch the pod go from PROVISIONING to ACTIVE.
        setProvisionResult(result);
        setProvisionedPodId(result.pod_id);
        // Notify parent immediately so the dashboard list shows PROVISIONING.
        onSubmit?.(result);
      } catch (err: unknown) {
        // Use error handler to map to user-friendly message
        const { message: errorMsg } = mapErrorToMessage(err);
        setError(errorMsg);
        showError(errorMsg, 4000);
      }
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleClose = () => {
    resetForm();
    setError(null);
    clearError();
    onClose();
  };

  const handleProvisioningComplete = () => {
    success("Pod is now active!");
    if (provisionResult) onSubmit?.(provisionResult);
    resetForm();
    onClose();
  };

  const handleProvisioningError = (err: Error) => {
    // Surface the failure, but leave PodProvisioningProgress mounted — it
    // owns its own error/failure UI (including the Stop control) so the
    // user can halt polling without the modal yanking the view out from
    // under them. Closing the modal (X button) resets the form for a retry.
    showError(err.message);
  };

  if (provisionedPodId !== null) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose}>
        <ModalHeader title="Provisioning Pod" onClose={handleClose} />
        <ModalBody>
          <PodProvisioningProgress
            podId={provisionedPodId}
            onComplete={handleProvisioningComplete}
            onError={handleProvisioningError}
          />
        </ModalBody>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <ModalHeader title="Provision New Pod" onClose={handleClose} />

      <ModalBody>
        {error && (
          <div className="mb-4 p-4 alert-error text-sm">
            <p>{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-600 hover:text-red-800 text-xs mt-2 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <StepTracker currentStep={currentStep} stepLabels={stepLabels} />

        {currentStep === 0 && (
          <div>
            <h3 className="text-lg font-bold text-text-main mb-4">Select a Scenario</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => setSelectedScenario(scenario.id)}
                  className={`p-4 border rounded-lg text-left transition ${
                    selectedScenario === scenario.id
                      ? "border-brand bg-brand/5 ring-1 ring-brand/20"
                      : "border-border hover:border-brand/40 bg-secondary"
                  }`}
                >
                  <p className="font-semibold text-sm text-text-main">{scenario.name}</p>
                  <p className="text-xs text-text-muted mt-1">MITRE: {scenario.mitre}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div>
            <h3 className="text-lg font-bold text-text-main mb-4">Review Configuration</h3>
            <div className="bg-muted border border-border rounded-lg p-4 text-sm">
              <p className="mb-2">
                <span className="text-text-muted">Scenario:</span>{" "}
                <span className="font-semibold text-text-main">
                  {scenarios.find((s) => s.id === selectedScenario)?.name}
                </span>
              </p>
              <p className="mb-2">
                <span className="text-text-muted">Duration:</span>{" "}
                <span className="font-semibold">60 minutes</span>
              </p>
              <p>
                <span className="text-text-muted">Resources:</span>{" "}
                <span className="font-semibold">4 GB RAM, 7 GB storage</span>
              </p>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="text-center py-8">
            <div className="mb-4 inline-block w-10 h-10 animate-spin rounded-full border-2 border-border border-t-brand" />
            <h3 className="text-lg font-bold text-text-main mb-2">Provisioning Pod</h3>
            <p className="text-text-muted text-sm">This may take a few moments...</p>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={handleBack} disabled={currentStep === 0 || apiLoading}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={handleNext}
          disabled={(currentStep === 0 && !selectedScenario) || apiLoading}
          loading={apiLoading}
        >
          {currentStep === 2 ? "Deploy" : "Next"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}