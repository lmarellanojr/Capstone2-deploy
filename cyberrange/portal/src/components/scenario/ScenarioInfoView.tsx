import { useEffect, useState } from "react";
import { ArrowRight, Lightbulb, RotateCcw } from "lucide-react";
import { Scenario, scenarioDisplayTitle } from "@/hooks/useScenarios";
import { Badge, Button, Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";
import { DifficultyBadge, scenarioDuration } from "@/components/scenarios/DifficultyBadge";
import { MilestoneItem } from "@/components/progress/MilestoneItem";
import { ScenarioTips } from "@/components/scenario/ScenarioTips";
import { provisioning } from "@/lib/api";

interface ScenarioInfoViewProps {
  scenario: Scenario;
  onStart: () => void;
  loading: boolean;
  error: string | null;
  /** Reopens the "Before you start — the big picture" welcome. */
  onShowBigPicture?: () => void;
}

export function ScenarioInfoView({ scenario, onStart, loading, error, onShowBigPicture }: ScenarioInfoViewProps) {
  const totalPoints = scenario.milestones.reduce((sum, m) => sum + m.points, 0);

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
  const allDone = completedIds.size === scenario.milestones.length;
  // Only point at a "next" task once the student has started — on a fresh
  // lab, highlighting task 1 adds nothing.
  const nextId =
    completedIds.size > 0 && !allDone ? scenario.milestones.find((m) => !completedIds.has(m.id))?.id : undefined;

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
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Badge variant={scenario.type === "offensive" ? "brand" : "info"}>
            {scenario.type === "offensive" ? "Offensive" : "Defensive"}
          </Badge>
          <DifficultyBadge difficulty={scenario.difficulty} />
          <span className="text-sm text-text-muted">{scenarioDuration(scenario.difficulty)}</span>
        </div>
        {/* GUIDE-UX-TRIAL / SCEN-UX #116: "Scenario N -- Name" so this page
            matches the catalog card and the lab header breadcrumb. */}
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-text-main">{scenarioDisplayTitle(scenario)}</h1>
        <p className="text-text-secondary text-lg">{scenario.description}</p>
      </div>

      <ScenarioTips scenarioId={scenario.id} className="mb-6" />

      <section className="mb-6 card-surface p-5 sm:p-6" aria-labelledby="objectives-heading">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 id="objectives-heading" className="text-lg font-semibold text-text-main">
            Objectives
          </h2>
          <span className="text-sm text-text-muted tabular-nums">
            {completedIds.size > 0 ? (
              <>
                <strong className="text-text-main">{earnedPoints}</strong> / {totalPoints} pts earned
              </>
            ) : (
              `${totalPoints} pts total`
            )}
          </span>
        </div>
        {allDone && (
          <div className="mb-4 p-3 alert-success text-sm font-medium flex items-center justify-between gap-3 flex-wrap">
            <span>
              You&apos;ve completed this scenario with full points. Starting again begins a new attempt in a
              fresh lab.
            </span>
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-green-900 underline hover:no-underline whitespace-nowrap rounded focus-ring"
            >
              <RotateCcw size={12} aria-hidden="true" />
              Reset score
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
              inProgress={m.id === nextId}
            />
          ))}
        </div>
        <p className="mt-4 text-xs text-text-muted">Maps to MITRE ATT&amp;CK {scenario.mitre}</p>
      </section>

      {error && error !== "POD_CAP_REACHED" && (
        <div role="alert" className="mb-6 p-4 alert-error text-sm">
          {error}
        </div>
      )}
      {error === "POD_CAP_REACHED" && (
        <div role="alert" className="mb-6 p-4 alert-warning text-sm">
          <p className="font-semibold">All lab slots are currently full</p>
          <p className="mt-1">Please wait for another student to finish their session.</p>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-3">
        {onShowBigPicture && (
          <Button variant="secondary" size="lg" onClick={onShowBigPicture} className="sm:w-auto">
            <Lightbulb size={18} aria-hidden="true" />
            Big Picture
          </Button>
        )}
        <Button variant="primary" size="lg" loading={loading} onClick={onStart} disabled={loading} className="flex-1">
          {allDone ? "Start a new attempt" : completedIds.size > 0 ? "Continue lab" : "Start Lab"}
          {!loading && <ArrowRight size={18} aria-hidden="true" />}
        </Button>
      </div>

      <Modal isOpen={showResetConfirm} onClose={() => setShowResetConfirm(false)}>
        <ModalHeader title="Reset your score for this scenario?" />
        <ModalBody>
          <p className="text-text-secondary mb-3">
            This will <strong className="text-text-main">permanently delete</strong> the{" "}
            <strong className="text-brand">
              {earnedPoints} / {totalPoints} pts
            </strong>{" "}
            you&apos;ve already earned on <strong className="text-text-main">{scenario.name}</strong>.
          </p>
          <p className="text-text-secondary">
            This cannot be undone. Your score will go back to 0 for this scenario, and you&apos;ll need to
            complete every milestone again from a fresh lab.
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
