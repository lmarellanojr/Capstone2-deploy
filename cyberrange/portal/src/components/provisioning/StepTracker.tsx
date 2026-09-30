import { Check } from "lucide-react";

interface StepTrackerProps {
  currentStep: number;
  stepLabels: string[];
}
 
export function StepTracker({ currentStep, stepLabels }: StepTrackerProps) {
  return (
    <div className="flex items-start mb-8">
      {stepLabels.map((label, index) => (
        <div key={index} className="flex items-start flex-1 min-w-0">
          <div className="flex flex-col items-center flex-shrink-0 w-16 sm:w-24">
            <div
              className={`flex items-center justify-center w-9 h-9 rounded-full font-bold text-sm transition flex-shrink-0 ${
                index < currentStep
                  ? "bg-success text-white"
                  : index === currentStep
                  ? "bg-brand text-white"
                  : "bg-muted text-text-muted border border-border"
              }`}
            >
              {index < currentStep ? <Check size={16} aria-label="Done" /> : index + 1}
            </div>
 
            <span
              className={`mt-2 text-xs font-semibold text-center break-words ${
                index === currentStep ? "text-text-main" : "text-text-muted"
              }`}
            >
              {label}
            </span>
          </div>
 
          {index < stepLabels.length - 1 && (
            <div
              className={`flex-1 h-0.5 mt-[17px] mx-1 sm:mx-2 rounded transition ${
                index < currentStep ? "bg-success" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
