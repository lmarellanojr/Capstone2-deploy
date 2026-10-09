import type { ReactNode } from "react";
import { Lightbulb } from "lucide-react";

// The one lab-specific thing a student most needs to know before starting,
// shared by the scenario landing page and the Big Picture welcome so the two
// can never say different things.
const TIPS: Record<string, { title: string; body: ReactNode }> = {
  "01": {
    title: "Run your commands in the Kali tab",
    body: (
      <>
        Run scans from <strong>Kali</strong>. Keep the Task 4 remote session open until credited,
        then return to Kali for the final username flag. Automatic checks run first;{" "}
        <strong>Manual Check</strong> is available once per task and can lead to instructor review.
      </>
    ),
  },
  "06": {
    title: "DVWA opens inside your lab",
    body: (
      <>
        Once your lab opens, the practice site loads <strong>right inside the lab page</strong>{" "}
        (no terminal needed), already connected to your session. Prefer a full window? Use{" "}
        <strong>Open in new tab</strong> at the top-right. Log in with{" "}
        <code className="bg-white/70 px-1 rounded">admin</code> /{" "}
        <code className="bg-white/70 px-1 rounded">password</code> and set Security to{" "}
        <strong>Low</strong>. Tasks 1–4 score automatically from DVWA responses; submit the
        Task 5 flag yourself in the portal.
      </>
    ),
  },
  "09": {
    title: "Generate activity first, then triage",
    body: (
      <>
        Generate a failed SSH login from <strong>Kali</strong>, then click <strong>Open SIEM</strong>
        and inspect your own meta agent's event. Write your scored files on the <strong>meta</strong> tab (
        <code className="bg-white/70 px-1 rounded">alert_triage.json</code>, timeline, report) as the
        guide describes.
      </>
    ),
  },
  "11": {
    title: "Work on the meta target",
    body: (
      <>
        Hardening happens on the <strong>Target: meta (lab)</strong> tab as{" "}
        <code className="bg-white/70 px-1 rounded">msfadmin</code> (lab sudo). Changes made on Kali
        won&apos;t fix the target and won&apos;t score.
      </>
    ),
  },
};

export function ScenarioTips({ scenarioId, className = "" }: { scenarioId: string; className?: string }) {
  const tip = TIPS[scenarioId];
  if (!tip) return null;
  return (
    <div className={`alert-info p-4 flex gap-3 text-sm ${className}`}>
      <Lightbulb size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="font-semibold mb-0.5">{tip.title}</p>
        <p className="leading-relaxed">{tip.body}</p>
      </div>
    </div>
  );
}
