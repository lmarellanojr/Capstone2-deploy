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
        (no terminal needed), already signed in with Security set to <strong>Low</strong>. Prefer a
        full window? Use <strong>Open in new tab</strong> at the top-right. If DVWA ever shows its
        login page, use <code className="bg-white/70 px-1 rounded">admin</code> /{" "}
        <code className="bg-white/70 px-1 rounded">password</code>. Tasks 1–4 score automatically from DVWA responses; submit the
        Task 5 flag yourself in the portal.
      </>
    ),
  },
  "09": {
    title: "Generate activity first, then triage",
    body: (
      <>
        Follow the guide <strong>Fast path</strong>: one failed SSH from <strong>Kali</strong>, click{" "}
        <strong>Open SIEM</strong> and your meta agent&apos;s rule 5710 event, then paste the guide
        skeletons on the <strong>meta</strong> tab (
        <code className="bg-white/70 px-1 rounded">alert_triage.json</code>, timeline, report). Replace
        every <code className="bg-white/70 px-1 rounded">PASTE…</code> value with what you observed.
      </>
    ),
  },
  "11": {
    title: "Work on the meta target",
    body: (
      <>
        Follow the guide <strong>Fast path</strong> on the <strong>Target: meta (lab)</strong> tab as{" "}
        <code className="bg-white/70 px-1 rounded">msfadmin</code>: view the Tomcat users file with{" "}
        <code className="bg-white/70 px-1 rounded">sudo</code>, change the default password, restart Tomcat, then confirm the old login gets{" "}
        <code className="bg-white/70 px-1 rounded">401</code> or{" "}
        <code className="bg-white/70 px-1 rounded">403</code>. Changes made on Kali won&apos;t score.
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
