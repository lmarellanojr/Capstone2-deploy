import type { AdminUser, AppRole } from "@/lib/api";

export type RoleFilter = "all" | AppRole | "none";
export type StatusFilter = "all" | "active" | "disabled";

// Role/status narrowing for the Admin Users table. Runs client-side on the
// already-searched list, so it composes with the server-side text search.
export function filterAdminUsers(users: AdminUser[], role: RoleFilter, status: StatusFilter): AdminUser[] {
  return users.filter((u) => {
    if (role === "none" ? u.role : role !== "all" && u.role !== role) return false;
    if (status === "active" && !u.enabled) return false;
    if (status === "disabled" && u.enabled) return false;
    return true;
  });
}
