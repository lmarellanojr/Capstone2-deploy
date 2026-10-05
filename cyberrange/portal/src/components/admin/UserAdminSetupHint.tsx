// #145 / ADM-USER contract §7: every /admin/users* call answers
// 503 "User management is not configured" until the one-time host setup has
// created the cyberrange-user-admin client. Shown wherever that error can
// surface (Users list, Create user), so the Admin always sees the fix.

export function isUserAdminNotConfigured(message: string | null | undefined): boolean {
  return !!message && /not configured/i.test(message);
}

export function UserAdminSetupHint({ message }: { message: string | null | undefined }) {
  if (!isUserAdminNotConfigured(message)) return null;
  return (
    <span className="block mt-1 text-xs">
      One-time setup: run <code className="bg-white/60 px-1 rounded">deploy/host/setup_user_admin_client.sh</code> on
      the host, then restart the provision API (manual 04, Step 9).
    </span>
  );
}
