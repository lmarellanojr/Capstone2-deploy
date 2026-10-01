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
        The scorer reads your <strong>Kali</strong> command history, so commands typed elsewhere
        don&apos;t count. If a task isn&apos;t detected, press <strong>Enter</strong> once more and use{" "}
        <strong>Manual Check</strong>.
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
        <strong>Low</strong>. Everything happens in the browser, and each task is scored
        automatically.
      </>
    ),
  },
  "09": {
    title: "Generate activity first, then triage",
    body: (
      <>
        Create attack noise from <strong>Kali</strong>, then click <strong>Open SIEM</strong> to see
        the alerts it raised for your lab. Write your scored files on the <strong>meta</strong> tab (
        <code className="bg-white/70 px-1 rounded">alert_triage.json</code>, timeline, report) as the
        guide describes.
      </>
    ),
  },
  "11": {
    title: "Work on the meta target",
    body: (
      <>
        Hardening happens on the <strong>Target: meta</strong> tab as{" "}
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
