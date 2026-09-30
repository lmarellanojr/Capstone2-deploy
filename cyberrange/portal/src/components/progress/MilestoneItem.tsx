import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

interface MilestoneItemProps {
  id: string;
  name: string;
  description: string;
  points: number;
  completed: boolean;
  /** The next task to work on — highlighted so "what do I do now?" is obvious. */
  inProgress?: boolean;
}

export function MilestoneItem({
  name,
  description,
  points,
  completed,
  inProgress = false,
}: MilestoneItemProps) {
  const Icon = completed ? CheckCircle2 : inProgress ? CircleDot : Circle;
  const iconColor = completed ? "text-success" : inProgress ? "text-brand" : "text-text-faint";
  const statusLabel = completed ? "Completed" : inProgress ? "Up next" : "Not started";

  return (
    <div
      className={`rounded-xl p-4 transition-colors ${
        completed
          ? "border border-border bg-muted/50"
          : inProgress
          ? "border-2 border-brand/40 bg-secondary"
          : "border border-border bg-secondary"
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon size={20} className={`mt-0.5 shrink-0 ${iconColor}`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className={`font-semibold text-sm ${completed ? "text-text-muted" : "text-text-main"}`}>
              <span className="sr-only">{statusLabel}: </span>
              {name}
            </h4>
            <Badge variant={completed ? "success" : inProgress ? "brand" : "default"}>{points} pts</Badge>
          </div>
          {inProgress && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand mb-1">Up next</p>
          )}
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
      </div>
    </div>
  );
}
