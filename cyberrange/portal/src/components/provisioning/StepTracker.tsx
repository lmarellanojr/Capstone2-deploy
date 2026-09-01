interface StepTrackerProps {
  currentStep: number;
  stepLabels: string[];
}

export function StepTracker({ currentStep, stepLabels }: StepTrackerProps) {
  return (
    <div className="flex items-center justify-between mb-8">
      {stepLabels.map((label, index) => (
        <div key={index} className="flex items-center flex-1 min-w-0">
          <div
            className={`flex items-center justify-center w-9 h-9 rounded-full font-bold text-sm transition flex-shrink-0 ${
              index < currentStep
                ? "bg-success text-white"
                : index === currentStep
                ? "bg-accent text-white"
                : "bg-muted text-text-muted border border-border"
            }`}
          >
            {index < currentStep ? "✓" : index + 1}
          </div>

          <span
            className={`ml-2 text-xs font-semibold truncate hidden sm:inline ${
              index === currentStep ? "text-text-main" : "text-text-muted"
            }`}
          >
            {label}
          </span>

          {index < stepLabels.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-2 sm:mx-4 rounded transition ${
                index < currentStep ? "bg-success" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}