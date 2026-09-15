import { Badge } from "./Badge";

/** Flags a section as placeholder data so reviewers/devs don't mistake it for a live API result. */
export function MockDataNotice({ label = "Mock data — not yet wired to a backend API" }: { label?: string }) {
  return <Badge variant="warning">{label}</Badge>;
}
