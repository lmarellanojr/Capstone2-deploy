import { Scenario } from "@/hooks/useScenarios";
import { Badge, Button } from "@/components/ui";
import { DifficultyBadge, scenarioDuration } from "@/components/scenarios/DifficultyBadge";
import { MilestoneItem } from "@/components/progress/MilestoneItem";

interface ScenarioInfoViewProps {
  scenario: Scenario;
  onStart: () => void;
  loading: boolean;
  error: string | null;
}

export function ScenarioInfoView({ scenario, onStart, loading, error }: ScenarioInfoViewProps) {
  const totalPoints = scenario.milestones.reduce((sum, m) => sum + m.points, 0);
  const typeVariant = scenario.type === "offensive" ? "danger" : "info";

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Badge variant={typeVariant}>{scenario.type.toUpperCase()}</Badge>
          <DifficultyBadge difficulty={scenario.difficulty} />
          <span className="text-sm text-text-secondary">
            {scenarioDuration(scenario.difficulty)} · MITRE {scenario.mitre}
          </span>
        </div>
        <h1 className="text-3xl font-bold mb-2 text-text-main">{scenario.name}</h1>
        <p className="text-text-secondary text-lg">{scenario.description}</p>
      </div>

      {scenario.id === "06" && (
        <div className="mb-8 p-4 alert-info text-sm">
          <p className="font-semibold text-blue-900 mb-1">Important: DVWA access</p>
          <p>
            Prefer the lab&apos;s <strong>Open DVWA</strong> control (your browser, session-gated)
            when available. Otherwise use the Kali terminal and{" "}
            <code className="bg-blue-100 px-1 rounded">$TARGET_DVWA</code>. SQLMap must run on{" "}
            <strong>Kali</strong> for scoring. You do not need a Kali desktop/VNC.
          </p>
        </div>
      )}
      {scenario.id === "09" && (
        <div className="mb-8 p-4 alert-info text-sm">
          <p className="font-semibold text-blue-900 mb-1">SIEM triage notes</p>
          <p>
            Generate attack noise from <strong>Kali</strong> first, then open the SIEM if{" "}
            <strong>Open SIEM</strong> is available. Write scored files on the{" "}
            <strong>meta</strong> tab (<code className="bg-blue-100 px-1 rounded">alert_triage.json</code>,
            timeline, report) as described in the guide.
          </p>
        </div>
      )}
      {scenario.id === "11" && (
        <div className="mb-8 p-4 alert-info text-sm">
          <p className="font-semibold text-blue-900 mb-1">Work on the meta target</p>
          <p>
            Hardening steps run on the <strong>meta</strong> terminal tab as{" "}
            <code className="bg-blue-100 px-1 rounded">msfadmin</code> (lab sudo). Kali is only for an
            optional re-test of the old Tomcat exploit.
          </p>
        </div>
      )}

      <div className="mb-8 card-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-main">Objectives</h2>
          <span className="text-sm text-text-secondary">{totalPoints} pts total</span>
        </div>
        <div className="flex flex-col gap-3">
          {scenario.milestones.map((m) => (
            <MilestoneItem
              key={m.id}
              id={String(m.id)}
              name={m.name}
              description={m.description}
              points={m.points}
              completed={false}
            />
          ))}
        </div>
      </div>

      {error && error !== "POD_CAP_REACHED" && (
        <div className="mb-6 p-4 alert-error text-sm">{error}</div>
      )}
      {error === "POD_CAP_REACHED" && (
        <div className="mb-6 p-4 alert-warning text-sm">
          <p className="font-semibold">All lab slots are currently full</p>
          <p className="mt-1">Please wait for another student to finish their session.</p>
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        loading={loading}
        onClick={onStart}
        disabled={loading}
        className="w-full"
      >
        Start Lab →
      </Button>
    </div>
  );
}