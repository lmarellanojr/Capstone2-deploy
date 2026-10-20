"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ChartNoAxesColumn, KeyRound, RefreshCw, Search, ShieldOff, UserPlus, Users } from "lucide-react";
import { UserRowMenu } from "@/components/admin/UserRowMenu";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, Button, LoadingSpinner, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { CreateUserModal } from "@/components/admin/CreateUserModal";
import { CredentialHandoffModal, type CredentialHandoff } from "@/components/admin/CredentialHandoffModal";
import { ResetPasswordModal } from "@/components/admin/ResetPasswordModal";
import { UserAdminSetupHint } from "@/components/admin/UserAdminSetupHint";
import { adminNavItems } from "@/lib/navigation";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useToastContext } from "@/context/ToastContext";
import { formatSqliteDate } from "@/lib/sqliteTime";
import { APP_ROLES } from "@/lib/adminUserValidation";
import { createCredentialFeedback, resetCredentialFeedback } from "@/lib/adminCredentialFeedback";
import { filterAdminUsers, type RoleFilter, type StatusFilter } from "@/lib/adminUserFilter";
import { ADMIN_USERS_MAX, type AdminUser, type AppRole, type ResearchExclusionReason } from "@/lib/api";

const ROLE_BADGE: Record<AppRole, "brand" | "info" | "default"> = {
  admin: "brand",
  instructor: "info",
  student: "default",
};
const ROLE_LABEL: Record<AppRole, string> = { student: "Student", instructor: "Instructor", admin: "Admin" };
const FILTER_SELECT =
  "rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40";

type PendingChange =
  | { kind: "disable"; user: AdminUser }
  | { kind: "role"; user: AdminUser; role: AppRole }
  | { kind: "mfa"; user: AdminUser }
  | { kind: "exclude"; user: AdminUser };

// v16 / PAPER-16: why an account is left out of the knowledge-gain export.
const EXCLUSION_REASON_LABEL: Record<ResearchExclusionReason, string> = {
  test_account: "Test account",
  team_member: "Team member",
  other: "Other",
};

function isStaff(u: AdminUser) {
  return u.roles.includes("instructor") || u.roles.includes("admin");
}

function displayName(u: AdminUser) {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return full || u.username || "—";
}

// ADM-USER (#32 / PR #88): live Keycloak users via /api/admin/users. The
// backend is the authority for every rule shown here (no self-disable/demote,
// never remove the last Admin); the UI just avoids offering those actions.
export default function AdminUsersPage() {
  const { data: session } = useSession();
  const actor = session?.user?.name ?? "";
  const { success, error: toastError } = useToastContext();
  const {
    users,
    loading,
    error,
    forbidden,
    pending,
    search,
    refresh,
    setEnabled,
    setRole,
    resetPassword,
    resetMfa,
    setResearchExclusion,
    createUser,
  } = useAdminUsers();
  const [excludeReason, setExcludeReason] = useState<ResearchExclusionReason>("test_account");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [confirm, setConfirm] = useState<PendingChange | null>(null);
  const [credentialHandoff, setCredentialHandoff] = useState<CredentialHandoff | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const firstRun = useRef(true);
  // Rows created or changed under the current search + filters stay visible
  // even if they no longer match; changing the search or a filter drops them
  // for good (state is reset during render, so returning to a view starts empty).
  const viewKey = JSON.stringify([query, roleFilter, statusFilter]);
  const [kept, setKept] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: viewKey, ids: new Set() });
  if (kept.key !== viewKey) setKept({ key: viewKey, ids: new Set() });
  const keptIds = kept.key === viewKey ? kept.ids : undefined;
  // `startKey` is the view the action began in; a request that finishes after
  // the Admin moved to another view is ignored rather than clobbering its pins.
  const keepVisible = (id: string, startKey: string) =>
    setKept((prev) => (prev.key === startKey ? { key: prev.key, ids: new Set(Array.from(prev.ids).concat(id)) } : prev));
  const visibleUsers = useMemo(
    () => filterAdminUsers(users, roleFilter, statusFilter, keptIds),
    [users, roleFilter, statusFilter, keptIds],
  );
  const filtered = roleFilter !== "all" || statusFilter !== "all";
  // The API only returns the first page, so filters/count cover loaded accounts only.
  const capped = users.length >= ADMIN_USERS_MAX;

  // Debounced server-side search (Keycloak matches username/name/email).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const id = setTimeout(() => void search(query), 300);
    return () => clearTimeout(id);
  }, [query, search]);

  const runChange = async (change: PendingChange) => {
    const startKey = viewKey;
    setConfirmBusy(true);
    try {
      if (change.kind === "disable") {
        await setEnabled(change.user.id, false);
        keepVisible(change.user.id, startKey);
        success(`${change.user.username} is disabled and signed out.`);
      } else if (change.kind === "mfa") {
        await resetMfa(change.user.id);
        success(`${change.user.username}'s authenticator was reset. They'll set up a new one at next sign-in.`);
      } else if (change.kind === "exclude") {
        await setResearchExclusion(change.user.id, true, excludeReason);
        keepVisible(change.user.id, startKey);
        success(`${change.user.username} is left out of reports. Their scores are kept.`);
      } else {
        await setRole(change.user.id, change.role);
        keepVisible(change.user.id, startKey);
        success(`${change.user.username} is now ${ROLE_LABEL[change.role]}. It applies at their next sign-in.`);
      }
      setConfirm(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "The change didn't go through.");
    } finally {
      setConfirmBusy(false);
    }
  };

  const enable = async (u: AdminUser) => {
    const startKey = viewKey;
    try {
      await setEnabled(u.id, true);
      keepVisible(u.id, startKey);
      success(`${u.username} can sign in again.`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Couldn't enable the user.");
    }
  };

  const includeInReports = async (u: AdminUser) => {
    const startKey = viewKey;
    try {
      await setResearchExclusion(u.id, false);
      keepVisible(u.id, startKey);
      success(`${u.username} is counted in reports again.`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Couldn't include the account.");
    }
  };

  if (forbidden) {
    return (
      <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
        <AccessDenied message="You need the admin role to manage users." />
      </LayoutWrapper>
    );
  }

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-text-main">Users</h1>
          <p className="text-text-muted mt-1">Accounts and role assignment (Keycloak)</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <UserPlus size={16} aria-hidden="true" />
          Create user
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[14rem] max-w-md">
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
          <input
            type="search"
            aria-label="Search users"
            placeholder="Search by username, name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-text-main placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
          />
        </div>
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className={FILTER_SELECT}
        >
          <option value="all">All roles</option>
          {APP_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
          <option value="none">No role</option>
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={FILTER_SELECT}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRoleFilter("all");
              setStatusFilter("all");
            }}
          >
            Clear filters
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
        {!loading && !error && (
          <span className="text-sm text-text-muted" aria-live="polite">
            {filtered ? `${visibleUsers.length} of ${users.length}` : users.length} {users.length === 1 ? "user" : "users"}
            {capped && ` (first ${ADMIN_USERS_MAX} loaded; search to narrow)`}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 p-3 alert-error text-sm flex flex-wrap items-center justify-between gap-3">
          <span>
            {error}
            <UserAdminSetupHint message={error} />
          </span>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {loading && users.length === 0 ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner message="Loading users…" />
          </div>
        ) : users.length > 0 && visibleUsers.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <Users size={28} className="mx-auto mb-3 text-text-faint" aria-hidden="true" />
            <p className="font-semibold text-text-main">No users match these filters</p>
            <p className="text-sm text-text-muted mt-1">
              {capped
                ? `Only the first ${ADMIN_USERS_MAX} accounts are loaded. Search by name to find others, or clear the filters.`
                : "Try another role or status, or clear the filters."}
            </p>
          </div>
        ) : users.length === 0 && !error ? (
          <div className="py-12 px-6 text-center">
            <Users size={28} className="mx-auto mb-3 text-text-faint" aria-hidden="true" />
            <p className="font-semibold text-text-main">{query ? `No users match “${query}”` : "No users yet"}</p>
            <p className="text-sm text-text-muted mt-1">
              {query ? "Try another name, username or email." : "Create the first account to get started."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th scope="col" className="py-3 px-4 font-semibold">User</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Email</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Role</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Status</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Created</th>
                  <th scope="col" className="py-3 px-4 font-semibold text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => {
                  const isSelf = !!actor && u.username === actor;
                  const busy = pending[u.id];
                  return (
                    <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-text-main">
                          {displayName(u)}
                          {isSelf && <span className="ml-2 text-xs font-medium text-text-muted">(you)</span>}
                        </p>
                        <p className="text-xs text-text-muted font-mono">{u.username}</p>
                        {!isStaff(u) && u.research_excluded && (
                          <span className="mt-1 inline-block">
                            <Badge variant="warning">
                              Not in reports ·{" "}
                              {u.research_exclusion_reason ? EXCLUSION_REASON_LABEL[u.research_exclusion_reason] : "Other"}
                            </Badge>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-text-muted">{u.email || "—"}</td>
                      <td className="py-3 px-4">
                        {isSelf ? (
                          u.role ? <Badge variant={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge> : <Badge>No role</Badge>
                        ) : (
                          <select
                            aria-label={`Role for ${u.username}`}
                            value={u.role ?? ""}
                            disabled={!!busy}
                            onChange={(e) => {
                              const role = e.target.value as AppRole;
                              if (role && role !== u.role) setConfirm({ kind: "role", user: u, role });
                            }}
                            className="rounded-lg border border-border bg-secondary px-2 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                          >
                            {!u.role && <option value="">No role</option>}
                            {APP_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={u.enabled ? "success" : "danger"} dot>
                          {u.enabled ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-text-muted whitespace-nowrap">
                        {formatSqliteDate(u.created_at)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {isSelf ? (
                          <span className="text-xs text-text-muted" title="Admins can't disable or change their own account">
                            Your account
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            {u.enabled ? (
                              <Button
                                variant="danger-outline"
                                size="sm"
                                disabled={!!busy}
                                loading={busy === "enabled"}
                                onClick={() => setConfirm({ kind: "disable", user: u })}
                              >
                                Disable
                              </Button>
                            ) : (
                              <Button variant="secondary" size="sm" disabled={!!busy} loading={busy === "enabled"} onClick={() => void enable(u)}>
                                Enable
                              </Button>
                            )}
                            <UserRowMenu
                              label={`More actions for ${u.username}`}
                              disabled={!!busy}
                              items={[
                                {
                                  label: "Reset password",
                                  icon: <KeyRound size={14} aria-hidden="true" />,
                                  onSelect: () => setResetting(u),
                                },
                                {
                                  label: "Reset MFA",
                                  icon: <ShieldOff size={14} aria-hidden="true" />,
                                  onSelect: () => setConfirm({ kind: "mfa", user: u }),
                                },
                                ...(isStaff(u)
                                  ? []
                                  : [
                                      u.research_excluded
                                        ? {
                                            label: "Include in reports",
                                            icon: <ChartNoAxesColumn size={14} aria-hidden="true" />,
                                            onSelect: () => void includeInReports(u),
                                            separated: true,
                                          }
                                        : {
                                            label: "Exclude from reports…",
                                            icon: <ChartNoAxesColumn size={14} aria-hidden="true" />,
                                            onSelect: () => {
                                              setExcludeReason("test_account");
                                              setConfirm({ kind: "exclude", user: u });
                                            },
                                            separated: true,
                                          },
                                    ]),
                              ]}
                              note={isStaff(u) ? "Instructors and admins are always left out of reports." : undefined}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ResetPasswordModal
        user={resetting}
        onClose={() => setResetting(null)}
        onReset={async (u, password, temporary) => {
          const updated = await resetPassword(u.id, password, temporary);
          setCredentialHandoff({ username: u.username ?? "", password, temporary });
          const feedback = resetCredentialFeedback(updated, temporary);
          success(feedback.message);
        }}
      />

      <CreateUserModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onCreate={createUser}
        onCreated={(u, password, temporary) => {
          keepVisible(u.id, viewKey);
          setCredentialHandoff({ username: u.username ?? "", password, temporary });
          const feedback = createCredentialFeedback(u, u.role ? ROLE_LABEL[u.role] : "no role");
          success(feedback.message);
        }}
      />

      <CredentialHandoffModal credentials={credentialHandoff} onClose={() => setCredentialHandoff(null)} />

      <Modal isOpen={confirm !== null} onClose={() => (confirmBusy ? undefined : setConfirm(null))}>
        {confirm && (
          <>
            <ModalHeader
              title={
                confirm.kind === "disable"
                  ? `Disable ${confirm.user.username}?`
                  : confirm.kind === "mfa"
                    ? `Reset ${confirm.user.username}'s authenticator?`
                    : confirm.kind === "exclude"
                      ? `Exclude ${confirm.user.username} from reports?`
                      : `Make ${confirm.user.username} ${ROLE_LABEL[confirm.role]}?`
              }
            />
            <ModalBody>
              {confirm.kind === "disable" ? (
                <p className="text-text-secondary">
                  They&apos;ll be signed out everywhere right away and won&apos;t be able to sign in until you enable
                  the account again. Their scores and history are kept.
                </p>
              ) : confirm.kind === "exclude" ? (
                <div className="space-y-3">
                  <p className="text-text-secondary">
                    Their scores are left out of the knowledge-gain export, so they don&apos;t count in completion
                    rate or time to milestone. Use this for test and team accounts. Nothing is deleted, and you can
                    include them again at any time.
                  </p>
                  <label className="block text-sm">
                    <span className="block font-semibold text-text-main mb-1">Reason</span>
                    <select
                      value={excludeReason}
                      onChange={(e) => setExcludeReason(e.target.value as ResearchExclusionReason)}
                      className={FILTER_SELECT}
                    >
                      {(Object.keys(EXCLUSION_REASON_LABEL) as ResearchExclusionReason[]).map((r) => (
                        <option key={r} value={r}>
                          {EXCLUSION_REASON_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : confirm.kind === "mfa" ? (
                <p className="text-text-secondary">
                  Use this when they&apos;ve lost or replaced their phone. Their current authenticator stops working,
                  they&apos;re signed out everywhere, and at their next sign-in they&apos;ll scan a new QR code. Their
                  password doesn&apos;t change.
                </p>
              ) : (
                <p className="text-text-secondary">
                  Changes <strong className="text-text-main">{confirm.user.username}</strong> from{" "}
                  <strong className="text-text-main">{confirm.user.role ? ROLE_LABEL[confirm.user.role] : "no role"}</strong> to{" "}
                  <strong className="text-text-main">{ROLE_LABEL[confirm.role]}</strong>. They&apos;ll be signed out, and
                  the new role applies when they sign in again.
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setConfirm(null)} disabled={confirmBusy} data-autofocus>
                Cancel
              </Button>
              <Button
                variant={confirm.kind === "disable" ? "danger" : "primary"}
                loading={confirmBusy}
                onClick={() => void runChange(confirm)}
              >
                {confirm.kind === "disable"
                  ? "Disable and sign out"
                  : confirm.kind === "mfa"
                    ? "Reset authenticator"
                    : confirm.kind === "exclude"
                      ? "Exclude from reports"
                      : "Change role"}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </LayoutWrapper>
  );
}
