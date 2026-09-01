import { Badge } from "@/components/ui";

interface DifficultyBadgeProps {
  difficulty: number;
}

export function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const config = {
    1: { label: "Easy", variant: "success" as const },
    2: { label: "Medium", variant: "warning" as const },
    3: { label: "Hard", variant: "danger" as const },
  };

  const { label, variant } = config[difficulty as 1 | 2 | 3] ?? config[1];

  return <Badge variant={variant}>{label}</Badge>;
}

export function scenarioDuration(difficulty: number): string {
  if (difficulty === 1) return "30 min";
  if (difficulty === 2) return "45 min";
  return "60 min";
}