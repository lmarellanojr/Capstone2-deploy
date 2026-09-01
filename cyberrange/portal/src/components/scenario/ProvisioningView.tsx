"use client";

import { useEffect, useState } from "react";
import { StepTracker } from "@/components/provisioning/StepTracker";

const STEPS = ["Cloning targets", "Configuring network", "Registering with SIEM", "Starting terminal"];
const STEP_DURATION_MS = 8_000;

export function ProvisioningView() {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    setCurrentStep(0);
    const interval = setInterval(() => {
      setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, STEP_DURATION_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="card-surface p-10">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 border-2 border-border border-t-brand rounded-full animate-spin" />
        </div>

        <h2 className="text-2xl font-bold text-center text-text-main mb-2">Provisioning Your Lab</h2>
        <p className="text-text-secondary text-center mb-10 text-sm">
          Setting up your isolated environment…
        </p>

        <StepTracker currentStep={currentStep} stepLabels={STEPS} />

        <p className="text-xs text-text-secondary text-center mt-6">
          This usually takes 30–60 seconds. Please don&apos;t close this tab.
        </p>
      </div>
    </div>
  );
}