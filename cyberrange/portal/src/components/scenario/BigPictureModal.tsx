"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Clock, Crosshair, Shield, Target } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter, useModalTitleId } from "@/components/ui";
import { MarkdownView, GUIDE_PROSE_CLASSES } from "@/components/scenario/MarkdownView";
import { ScenarioTips } from "@/components/scenario/ScenarioTips";
import { scenarioDuration } from "@/components/scenarios/DifficultyBadge";
import { loadBigPicture } from "@/lib/guideSections";
import { injectPodIpsIntoGuide } from "@/lib/podIps";
import type { Scenario } from "@/hooks/useScenarios";

interface BigPictureModalProps {
  scenario: Scenario;
  isOpen: boolean;
  onClose: () => void;
  /** Present on the pre-lab landing page: the primary action starts the lab. */
  onStart?: () => void;
  starting?: boolean;
  /** Present once a lab is running: $TARGET_* placeholders become real IPs. */
  podId?: number;
}

type LoadState = { status: "loading" } | { status: "ready"; body: string } | { status: "unavailable" };

export function BigPictureModal(props: BigPictureModalProps) {
  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} size="lg">
      <BigPictureContent {...props} />
    </Modal>
  );
}

// Split out so it mounts only while the dialog is open (Modal renders nothing
// when closed) and can read the dialog's title id from context.
function BigPictureContent({ scenario, onClose, onStart, starting = false, podId }: BigPictureModalProps) {
  const titleId = useModalTitleId();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loadBigPicture(scenario.guideFile)
      .then((raw) => {
        if (!active) return;
        if (!raw) {
          setState({ status: "unavailable" });
          return;
        }
        setState({ status: "ready", body: podId != null ? injectPodIpsIntoGuide(raw, podId) : raw });
      })
      .catch(() => {
        if (active) setState({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [scenario.guideFile, podId]);

  const totalPoints = scenario.milestones.reduce((sum, m) => sum + m.points, 0);
  const attacker = scenario.type === "offensive";
  const facts = [
    { label: "Your role", value: attacker ? "Attacker" : "Defender", Icon: attacker ? Crosshair : Shield },
    { label: "Your goal", value: `${scenario.milestones.length} tasks · ${totalPoints} pts`, Icon: Target },
    { label: "Time", value: scenarioDuration(scenario.difficulty), Icon: Clock },
  ];

  return (
    <>
      <div className={`h-1.5 shrink-0 ${attacker ? "bg-brand" : "bg-blue-700"}`} aria-hidden="true" />
      <div className="px-5 sm:px-8 pt-6 pb-5 pr-14 shrink-0 border-b border-border">
        <p className={`text-xs font-bold uppercase tracking-widest ${attacker ? "text-brand" : "text-blue-700"}`}>
          Before you start · Scenario {scenario.displayNumber}
        </p>
        <h2 id={titleId} className="mt-2 text-2xl sm:text-3xl font-bold text-text-main">
          {scenario.name}
        </h2>

        <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {facts.map(({ label, value, Icon }) => (
            <div key={label} className="rounded-xl border border-border bg-primary px-4 py-3 flex items-start gap-3">
              <Icon size={18} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
                <dd className="text-sm font-semibold text-text-main">{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>

      <ModalBody className="space-y-5">
        <ScenarioTips scenarioId={scenario.id} />

        {state.status === "loading" && (
          <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading the overview">
            <div className="h-3.5 w-11/12 rounded-full bg-muted" />
            <div className="h-3.5 w-10/12 rounded-full bg-muted" />
            <div className="h-3.5 w-8/12 rounded-full bg-muted" />
            <div className="h-24 w-full rounded-xl bg-muted" />
          </div>
        )}

        {state.status === "ready" && (
          <div className={GUIDE_PROSE_CLASSES}>
            <MarkdownView content={state.body} />
          </div>
        )}

        {state.status === "unavailable" && (
          <div className="rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">
            <p className="font-medium text-text-main mb-1">{scenario.description}</p>
            <p>
              The full walkthrough is in the <strong>Guide</strong> tab once your lab is running.
            </p>
          </div>
        )}
      </ModalBody>

      <ModalFooter className="items-center">
        {onStart ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={starting}>
              Not now
            </Button>
            <Button variant="primary" onClick={onStart} loading={starting} data-autofocus>
              Let&apos;s Go
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <Button variant="primary" onClick={onClose} data-autofocus>
            Back to the lab
          </Button>
        )}
      </ModalFooter>
    </>
  );
}
