/** Shown when the backend returns 403 — authenticated but missing the instructor/admin role. */
export function AccessDenied({ message = "You don't have permission to view this page." }: { message?: string }) {
  return (
    <div className="card-surface p-10 text-center">
      <p className="text-lg font-semibold text-text-main mb-1">Access denied</p>
      <p className="text-text-muted text-sm">{message}</p>
    </div>
  );
}
