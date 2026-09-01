import { Badge } from "@/components/ui";

interface MilestoneItemProps {
  id: string;
  name: string;
  description: string;
  points: number;
  completed: boolean;
  inProgress?: boolean;
}

export function MilestoneItem({
  name,
  description,
  points,
  completed,
  inProgress = false,
}: MilestoneItemProps) {
  const getStatusIcon = () => {
    if (completed) return "✓";
    if (inProgress) return "◐";
    return "○";
  };

  const getStatusColor = () => {
    if (completed) return "text-success";
    if (inProgress) return "text-warning";
    return "text-text-muted";
  };

  return (
    <div
      className={`border border-border rounded-lg p-4 bg-secondary ${
        completed ? "opacity-80 bg-muted/50" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`text-xl mt-0.5 ${getStatusColor()}`}>{getStatusIcon()}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="font-semibold text-text-main text-sm">{name}</h4>
            <Badge variant={completed ? "success" : "default"}>{points} pts</Badge>
          </div>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
      </div>
    </div>
  );
}