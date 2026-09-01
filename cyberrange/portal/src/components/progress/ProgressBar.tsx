interface ProgressBarProps {
  current: number;
  total: number;
  label?: string;
}

export function ProgressBar({ current, total, label }: ProgressBarProps) {
  const percentage = Math.round((current / total) * 100);

  return (
    <div>
      {label && (
        <div className="flex justify-between mb-2">
          <span className="text-sm font-semibold text-text-main">{label}</span>
          <span className="text-sm text-text-secondary">
            {current} / {total}
          </span>
        </div>
      )}

      <div className="w-full bg-muted border border-border rounded-full h-2.5 overflow-hidden">
        <div
          className="h-full bg-brand transition-all duration-300 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <p className="text-xs text-text-secondary mt-2">{percentage}% complete</p>
    </div>
  );
}