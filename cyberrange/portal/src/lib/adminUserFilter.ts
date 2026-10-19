import type { AdminUser, AppRole } from "@/lib/api";

export type RoleFilter = "all" | AppRole | "none";
export type StatusFilter = "all" | "active" | "disabled";

const NO_KEEP: ReadonlySet<string> = new Set();

// Role/status narrowing for the Admin Users table. Runs client-side on the
// already-searched list, so it composes with the server-side text search.
// `keep` lets ids through regardless (rows the Admin just created or changed),
// so a row doesn't vanish the moment it stops matching the active filters.
export function filterAdminUsers(
  users: AdminUser[],
  role: RoleFilter,
  status: StatusFilter,
  keep: ReadonlySet<string> = NO_KEEP,
): AdminUser[] {
  return users.filter((u) => {
    if (keep.has(u.id)) return true;
    if (role === "none" && u.role !== null) return false;
    if (role !== "all" && role !== "none" && u.role !== role) return false;
    if (status === "active" && !u.enabled) return false;
    if (status === "disabled" && u.enabled) return false;
    return true;
  });
}
