import { useEffect, useState } from "react";
import { Scenario, scenarioDisplayTitle } from "@/hooks/useScenarios";
import { Badge, Button, Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";
import { DifficultyBadge, scenarioDuration } from "@/components/scenarios/DifficultyBadge";
import { MilestoneItem } from "@/components/progress/MilestoneItem";
import { provisioning } from "@/lib/api";

interface ScenarioInfoViewProps {
  scenario: Scenario;
  onStart: () => void;
  loading: boolean;
  error: string | null;
}

export function ScenarioInfoView({ scenario, onStart, loading, error }: ScenarioInfoViewProps) {
  const totalPoints = scenario.milestones.reduce((sum, m) => sum + m.points, 0);
  const typeVariant = scenario.type === "offensive" ? "danger" : "info";

  // Milestone results persist in the DB independent of any active pod
  // (score-persistence, issue #11), but this pre-lab landing page previously
  // never read them back -- it always rendered every milestone as fresh/
  // incomplete, even right after finishing the scenario, because a
  // completed pod gets torn down and there's no pod-scoped endpoint to ask
  // once it's gone. GET /progress has no pod dependency, so it works here.
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let active = true;
    const scenarioIdNum = Number(scenario.id);
    provisioning
      .getProgress()
      .then((res) => {
        if (!active) return;
        const passed = res.milestones
          .filter((m) => m.scenario_id === scenarioIdNum && m.status === "PASS")
          .map((m) => m.milestone_id);
        setCompletedIds(new Set(passed));
      })
      .catch(() => {
        // Non-fatal: landing page still works, just without prior-progress badges.
      });
    return () => {
      active = false;
    };
  }, [scenario.id]);

  const earnedPoints = scenario.milestones
    .filter((m) => completedIds.has(m.id))
    .reduce((sum, m) => sum + m.points, 0);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleResetConfirmed = async () => {
    setResetting(true);
    try {
      await provisioning.resetScenarioProgress(Number(scenario.id));
      setCompletedIds(new Set());
      setShowResetConfirm(false);
    } catch {
      // Leave the modal open with its existing warning text on failure --
      // no separate error UI here since this is a rare, low-stakes path
      // (worst case the student just tries the button again).
    } finally {
      setResetting(false);
    }
  };

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
        {/* GUIDE-UX-TRIAL / SCEN-UX #116: "Scenario N -- Name" so this page
            matches the catalog card and the lab header breadcrumb. */}
        <h1 className="text-3xl font-bold mb-2 text-text-main">
          {scenarioDisplayTitle(scenario)}
        </h1>
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
          <span className="text-sm text-text-secondary">
            {completedIds.size > 0 ? (
              <>
                <strong className="text-text-main">{earnedPoints}</strong> / {totalPoints} pts earned
              </>
            ) : (
              `${totalPoints} pts total`
            )}
          </span>
        </div>
        {completedIds.size === scenario.milestones.length && (
          <div className="mb-4 p-3 alert-success text-sm font-medium flex items-center justify-between gap-3 flex-wrap">
            <span>
              You&apos;ve already completed this scenario with full points. Starting again
              begins a new attempt in a fresh pod.
            </span>
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-xs font-semibold text-green-900 underline hover:no-underline whitespace-nowrap"
            >
              Try Again (reset score)
            </button>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {scenario.milestones.map((m) => (
            <MilestoneItem
              key={m.id}
              id={String(m.id)}
              name={m.name}
              description={m.description}
              points={m.points}
              completed={completedIds.has(m.id)}
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

      <Modal isOpen={showResetConfirm} onClose={() => setShowResetConfirm(false)}>
        <ModalHeader title="Reset your score for this scenario?" />
        <ModalBody>
          <p className="text-text-secondary mb-3">
            This will <strong className="text-text-main">permanently delete</strong> the{" "}
            <strong className="text-brand">{earnedPoints} / {totalPoints} pts</strong> you&apos;ve
            already earned on <strong className="text-text-main">{scenario.name}</strong>.
          </p>
          <p className="text-text-secondary">
            This cannot be undone. Your score will go back to 0 for this scenario, and
            you&apos;ll need to complete every milestone again from a fresh pod.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setShowResetConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={resetting} onClick={handleResetConfirmed}>
            Yes, reset to 0
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}