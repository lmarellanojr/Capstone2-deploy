"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ScrollText, X } from "lucide-react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, Button, LoadingSpinner } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { useAuditLog } from "@/hooks/useAuditLog";
import { auditEventLabel, auditResultVariant, parseAuditDetail } from "@/lib/auditEvents";
import { formatSqliteDate } from "@/lib/sqliteTime";

const RESULTS = ["OK", "FAILED", "DENIED"];

// Audit trail viewer (admin gaps item 3). Read-only: nothing here can edit or
// delete history. Passwords and tokens are never written to audit_log.
export default function AdminAuditLogPage() {
  const [eventType, setEventType] = useState("");
  const [result, setResult] = useState("");
  const [userInput, setUserInput] = useState("");
  const [studentId, setStudentId] = useState("");

  // Debounce the free-text user filter; the selects apply immediately.
  useEffect(() => {
    const id = setTimeout(() => setStudentId(userInput.trim()), 350);
    return () => clearTimeout(id);
  }, [userInput]);

  const { events, eventTypes, loading, loadingMore, error, forbidden, hasMore, loadMore, refresh } = useAuditLog({
    eventType,
    result,
    studentId,
  });
  const filtered = Boolean(eventType || result || studentId);

  if (forbidden) {
    return (
      <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
        <AccessDenied message="You need the admin role to view the audit log." />
      </LayoutWrapper>
    );
  }

  const select =
    "rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40";

  return (
    <LayoutWrapper navItems={adminNavItems} sectionLabel="Admin" hideSearch>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-text-main">Audit log</h1>
          <p className="text-text-muted mt-1">Who did what, newest first. Read-only.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block font-semibold text-text-main mb-1">Event</span>
          <select className={select} value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">All events</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {auditEventLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-text-main mb-1">Result</span>
          <select className={select} value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">Any result</option>
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-text-main mb-1">User</span>
          <input
            type="search"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Exact username"
            className={`${select} w-48`}
          />
        </label>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setEventType("");
              setResult("");
              setUserInput("");
              setStudentId("");
            }}
            className="inline-flex items-center gap-1 pb-2 text-sm font-semibold text-brand hover:underline rounded focus-ring"
          >
            <X size={14} aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 p-3 alert-error text-sm">
          {error}
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {loading && events.length === 0 ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner message="Loading audit events…" />
          </div>
        ) : events.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <ScrollText size={28} className="mx-auto mb-3 text-text-faint" aria-hidden="true" />
            <p className="font-semibold text-text-main">{filtered ? "No events match these filters" : "No audit events yet"}</p>
            <p className="text-sm text-text-muted mt-1">
              {filtered ? "Try widening the filters." : "Admin actions like user changes and force-destroys appear here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th scope="col" className="py-3 px-4 font-semibold">When</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Event</th>
                  <th scope="col" className="py-3 px-4 font-semibold">By</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Target</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Result</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const { actor, facts } = parseAuditDetail(e.detail);
                  return (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/20 align-top">
                      <td className="py-3 px-4 text-text-muted whitespace-nowrap tabular-nums">{formatSqliteDate(e.timestamp)}</td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-text-main">{auditEventLabel(e.event_type)}</p>
                        {auditEventLabel(e.event_type) !== e.event_type && (
                          <p className="text-[11px] font-mono text-text-faint">{e.event_type}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-text-main">{actor ?? "—"}</td>
                      <td className="py-3 px-4">
                        <p className="font-mono text-xs text-text-main">{e.student_id || "—"}</p>
                        {e.pod_id != null && <p className="text-xs text-text-muted">Pod {e.pod_id}</p>}
                      </td>
                      <td className="py-3 px-4">
                        {e.result ? (
                          <Badge variant={auditResultVariant(e.result)} dot>
                            {e.result}
                          </Badge>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-text-secondary break-words max-w-xs">{facts || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
            Load older events
          </Button>
        </div>
      )}
    </LayoutWrapper>
  );
}
