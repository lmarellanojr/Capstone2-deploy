import { Badge } from "./Badge";

// Used on every Instructor/Admin route shell page (UI-01) to flag mock data.
/** Flags a section as placeholder data so reviewers/devs don't mistake it for a live API result. */
export function MockDataNotice({ label = "Mock data — not yet wired to a backend API" }: { label?: string }) {
  return <Badge variant="warning">{label}</Badge>;
}
