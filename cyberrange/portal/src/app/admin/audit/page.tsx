"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, ScrollText, X } from "lucide-react";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { AccessDenied, Badge, Button, LoadingSpinner } from "@/components/ui";
import { adminNavItems } from "@/lib/navigation";
import { useAuditLog } from "@/hooks/useAuditLog";
import {
  AUDIT_CATEGORIES,
  AuditCategory,
  auditActor,
  auditCategoryTypes,
  auditEventCategory,
  auditEventDescription,
  auditEventLabel,
  auditResult,
  auditResultLabel,
  auditResultVariant,
  humanizeAuditFacts,
} from "@/lib/auditEvents";
import {
  AUDIT_CSV_MAX_ROWS,
  auditCsvFilename,
  buildAuditCsv,
  fetchAuditEventsForCsv,
  saveCsvBlob,
} from "@/lib/auditCsv";
import { backendDetail } from "@/lib/errorHandler";
import { formatSqliteDate } from "@/lib/sqliteTime";

const RESULTS = ["OK", "FAILED", "DENIED"];

const EMPTY_HINTS: Record<AuditCategory | "all", string> = {
  admin: "User changes and force-destroys appear here.",
  lab: "Lab start-up steps, failures and automatic clean-up appear here.",
  scoring: "Task checks, flag submissions and review grading appear here.",
  all: "Admin actions, lab activity and scoring appear here.",
};

// Audit trail viewer (admin gaps item 3). Read-only: nothing here can edit or
// delete history. Passwords and tokens are never written to audit_log.
export default function AdminAuditLogPage() {
  const [category, setCategory] = useState<AuditCategory | "all">("admin");
  const [eventType, setEventType] = useState("");
  const [result, setResult] = useState("");
  const [userInput, setUserInput] = useState("");
  const [studentId, setStudentId] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  // Debounce the free-text user filter; the selects apply immediately.
  useEffect(() => {
    const id = setTimeout(() => setStudentId(userInput.trim()), 350);
    return () => clearTimeout(id);
  }, [userInput]);

  const categoryTypes = useMemo(() => (category === "all" ? [] : auditCategoryTypes(category)), [category]);
  const { events, eventTypes, loading, loadingMore, error, forbidden, hasMore, loadMore, refresh } = useAuditLog({
    eventType,
    categoryTypes,
    result,
    studentId,
  });
  // The Event dropdown only offers types that exist and belong to the tab.
  const typeOptions = eventTypes.filter((t) => category === "all" || auditEventCategory(t) === category);
  const filtered = Boolean(eventType || result || studentId);

  const chooseCategory = (next: AuditCategory | "all") => {
    setCategory(next);
    if (eventType && next !== "all" && auditEventCategory(eventType) !== next) setEventType("");
  };

  const downloadCsv = async () => {
    setDownloading(true);
    setDownloadError(null);
    setDownloadStatus(null);
    try {
      const { events: rows, truncated } = await fetchAuditEventsForCsv({
        eventType,
        eventTypes: categoryTypes,
        result,
        studentId,
      });
      if (rows.length === 0) {
        setDownloadStatus("No events match these filters.");
        return;
      }
      const name = auditCsvFilename();
      saveCsvBlob(buildAuditCsv(rows), name);
      setDownloadStatus(
        truncated
          ? `Downloaded the newest ${AUDIT_CSV_MAX_ROWS.toLocaleString()} matching events as ${name}. Narrow the filters to export the rest.`
          : `Downloaded ${rows.length.toLocaleString()} event${rows.length === 1 ? "" : "s"} as ${name}.`
      );
    } catch (err) {
      setDownloadError(backendDetail(err));
    } finally {
      setDownloading(false);
    }
  };

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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void downloadCsv()}
            loading={downloading}
            disabled={loading || downloading}
          >
            {!downloading && <Download size={14} aria-hidden="true" />}
            Download CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading || downloading}>
            <RefreshCw size={14} aria-hidden="true" className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      <div role="group" aria-label="Event category" className="mb-4 inline-flex flex-wrap rounded-lg border border-border bg-secondary p-1">
        {AUDIT_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => chooseCategory(c.id)}
            aria-pressed={category === c.id}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold focus-ring ${
              category === c.id ? "bg-brand text-white" : "text-text-muted hover:text-text-main"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block font-semibold text-text-main mb-1">Event</span>
          <select className={select} value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">All events</option>
            {typeOptions.map((t) => (
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
                {auditResultLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-text-main mb-1">Affected user</span>
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
      {downloadError && (
        <div role="alert" className="mb-4 p-3 alert-error text-sm">
          {downloadError}
        </div>
      )}
      {downloadStatus && (
        <p role="status" className="mb-4 text-sm text-success">
          {downloadStatus}
        </p>
      )}

      <div className="card-surface overflow-hidden">
        {loading && events.length === 0 ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner message="Loading audit events…" />
          </div>
        ) : events.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <ScrollText size={28} className="mx-auto mb-3 text-text-faint" aria-hidden="true" />
            <p className="font-semibold text-text-main">{filtered ? "No events match these filters" : "No events here yet"}</p>
            <p className="text-sm text-text-muted mt-1">{filtered ? "Try widening the filters." : EMPTY_HINTS[category]}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border bg-muted/30">
                  <th scope="col" className="py-3 px-4 font-semibold">When</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Event</th>
                  <th scope="col" className="py-3 px-4 font-semibold">By</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Affected user</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Result</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const { actor, system, facts } = auditActor(e);
                  const outcome = auditResult(e);
                  const description = auditEventDescription(e.event_type);
                  const details = humanizeAuditFacts(facts);
                  return (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/20 align-top">
                      <td className="py-3 px-4 text-text-muted whitespace-nowrap tabular-nums">{formatSqliteDate(e.timestamp)}</td>
                      <td className="py-3 px-4 max-w-xs" title={e.event_type}>
                        <p className="font-semibold text-text-main">{auditEventLabel(e.event_type)}</p>
                        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
                      </td>
                      <td className="py-3 px-4">
                        {system ? (
                          <span className="text-xs italic text-text-muted">{actor}</span>
                        ) : (
                          <span className="font-mono text-xs text-text-main">{actor}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-mono text-xs text-text-main">{e.student_id || "—"}</p>
                        {e.pod_id != null && <p className="text-xs text-text-muted">Pod {e.pod_id}</p>}
                      </td>
                      <td className="py-3 px-4">
                        {outcome ? (
                          <Badge variant={auditResultVariant(outcome)} dot>
                            {auditResultLabel(outcome)}
                          </Badge>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-text-secondary break-words max-w-xs" title={e.detail ?? undefined}>
                        {details || "—"}
                      </td>
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
