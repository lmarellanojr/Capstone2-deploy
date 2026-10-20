"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { instructor } from "@/lib/api";
import { backendDetail } from "@/lib/errorHandler";
import { SCENARIOS, scenarioDisplayTitle } from "@/hooks/useScenarios";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SCORE-02 (#101) / PAPER-16: download knowledge-gain scoring records.
 *  Always anonymized for instructors; only admins (allowIdentified) can opt
 *  out and download real usernames (#271, enforced by the API). */
export function KnowledgeGainExport({ allowIdentified = false }: { allowIdentified?: boolean }) {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [anonymizeChoice, setAnonymize] = useState(true);
  const anonymize = allowIdentified ? anonymizeChoice : true;
  const [includeExcludedChoice, setIncludeExcluded] = useState(false);
  const includeExcluded = allowIdentified && includeExcludedChoice;
  const [scenarioId, setScenarioId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [staffWarning, setStaffWarning] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    setStaffWarning(false);
    try {
      const result = await instructor.exportKnowledgeGain({
        format,
        anonymize,
        scenarioId: scenarioId ? Number(scenarioId) : undefined,
        includeExcluded,
      });
      const name = `knowledge_gain_${anonymize ? "anonymized" : "identified"}${includeExcluded ? "_all_accounts" : ""}${scenarioId ? `_s${Number(scenarioId)}` : ""}.${format}`;
      saveBlob(result.blob, name);
      const n = result.excludedAccounts;
      setDone(
        includeExcluded
          ? `Downloaded ${name}. Test and staff accounts are included.`
          : n === null
            ? `Downloaded ${name}`
            : `Downloaded ${name}. Left out ${n} test or staff ${n === 1 ? "account" : "accounts"}.`
      );
      setStaffWarning(result.staffExclusion === "unavailable");
    } catch (err) {
      const msg = backendDetail(err);
      setError(
        msg.includes("TELEMETRY_ANONYMIZATION_SALT")
          ? allowIdentified
            ? "Anonymized export isn't configured on this server (TELEMETRY_ANONYMIZATION_SALT is not set). Set it on the host, or turn off anonymization."
            : "Anonymized export isn't configured on this server (TELEMETRY_ANONYMIZATION_SALT is not set). Ask an admin to set it."
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const select =
    "rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40";

  return (
    <section className="card-surface p-6" aria-labelledby="kg-export-heading">
      <h2 id="kg-export-heading" className="text-lg font-bold text-text-main mb-1">
        Export knowledge-gain data
      </h2>
      <p className="text-sm text-text-muted mb-4">Scoring records for research analysis (PAPER-16).</p>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="block font-semibold text-text-main mb-1">Scenario</span>
          <select className={select} value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            <option value="">All scenarios</option>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {scenarioDisplayTitle(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-text-main mb-1">Format</span>
          <select className={select} value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
            <option value="csv">CSV (spreadsheet)</option>
            <option value="json">JSON (with summary)</option>
          </select>
        </label>
        {allowIdentified && (
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={anonymize}
              onChange={(e) => setAnonymize(e.target.checked)}
              className="rounded border-border text-brand focus:ring-brand/30"
            />
            Anonymize student IDs
          </label>
        )}
        {allowIdentified && (
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={includeExcluded}
              onChange={(e) => setIncludeExcluded(e.target.checked)}
              className="rounded border-border text-brand focus:ring-brand/30"
            />
            Include test and staff accounts
          </label>
        )}
        <Button variant="primary" onClick={() => void run()} loading={busy}>
          {!busy && <Download size={16} aria-hidden="true" />}
          Download
        </Button>
      </div>

      <p className="mt-3 text-xs text-text-muted">
        {!allowIdentified && "Student IDs are anonymized. Identified exports are admin-only. "}
        Accounts excluded from reports in Admin → Users, and all instructor and admin accounts, are left out.
      </p>
      {includeExcluded && (
        <p className="mt-3 text-xs text-warning font-medium">
          For checking only: this file counts test and staff accounts as students. Don&apos;t use it for the study
          results.
        </p>
      )}
      {staffWarning && (
        <p role="alert" className="mt-3 text-xs text-warning font-medium">
          Staff accounts couldn&apos;t be checked because user management isn&apos;t reachable, so instructor and
          admin accounts may be in this file. Ask an admin to check user management (Admin → Users), then download
          again.
        </p>
      )}
      {!anonymize && (
        <p className="mt-3 text-xs text-warning font-medium">
          This file will contain real student usernames. Handle it as personal data.
        </p>
      )}
      {error && (
        <div role="alert" className="mt-4 p-3 alert-error text-sm">
          {error}
        </div>
      )}
      {done && (
        <p role="status" className="mt-3 text-sm text-success">
          {done}
        </p>
      )}
    </section>
  );
}
