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
 *  Anonymized by default — cleartext student ids are an explicit opt-out. */
export function KnowledgeGainExport() {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [anonymize, setAnonymize] = useState(true);
  const [scenarioId, setScenarioId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const blob = await instructor.exportKnowledgeGain({
        format,
        anonymize,
        scenarioId: scenarioId ? Number(scenarioId) : undefined,
      });
      const name = `knowledge_gain_${anonymize ? "anonymized" : "identified"}${scenarioId ? `_s${Number(scenarioId)}` : ""}.${format}`;
      saveBlob(blob, name);
      setDone(`Downloaded ${name}`);
    } catch (err) {
      const msg = backendDetail(err);
      setError(
        msg.includes("TELEMETRY_ANONYMIZATION_SALT")
          ? "Anonymized export isn't configured on this server (TELEMETRY_ANONYMIZATION_SALT is not set). Ask an admin to set it, or turn off anonymization."
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
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer pb-2">
          <input
            type="checkbox"
            checked={anonymize}
            onChange={(e) => setAnonymize(e.target.checked)}
            className="rounded border-border text-brand focus:ring-brand/30"
          />
          Anonymize student IDs
        </label>
        <Button variant="primary" onClick={() => void run()} loading={busy}>
          {!busy && <Download size={16} aria-hidden="true" />}
          Download
        </Button>
      </div>

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
