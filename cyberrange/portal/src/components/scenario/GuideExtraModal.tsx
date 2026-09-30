"use client";

import { useEffect, useState } from "react";
import { Gauge, Wrench } from "lucide-react";
// Direct paths (not the "@/components/ui" barrel): rendered by TerminalView,
// whose tests replace the barrel with a partial mock.
import { Button } from "@/components/ui/Button";
import { Modal, ModalBody, ModalFooter, useModalTitleId } from "@/components/ui/Modal";
import { MarkdownView, GUIDE_PROSE_CLASSES } from "@/components/scenario/MarkdownView";
import { loadGuideMarkdown, splitGuide } from "@/lib/guideSections";
import { injectPodIpsIntoGuide } from "@/lib/podIps";
import type { Scenario } from "@/hooks/useScenarios";

export type GuideExtra = "tools" | "scoring";

interface GuideExtraModalProps {
  scenario: Scenario;
  podId: number;
  /** Which part of the guide to show; null = closed. */
  which: GuideExtra | null;
  onClose: () => void;
}

/** The guide's "tools you'll use" and "How scoring works" sections as
 *  pop-ups, opened from the terminal's Tools icon and the Score card, so the
 *  step-by-step Guide stays uncluttered. Content comes from the guide file. */
export function GuideExtraModal({ scenario, podId, which, onClose }: GuideExtraModalProps) {
  return (
    <Modal isOpen={which !== null} onClose={onClose} size="lg">
      {which && <Content scenario={scenario} podId={podId} which={which} onClose={onClose} />}
    </Modal>
  );
}

type State =
  | { status: "loading" }
  | { status: "ready"; title: string; body: string | null }
  | { status: "error" };

function Content({ scenario, podId, which, onClose }: GuideExtraModalProps & { which: GuideExtra }) {
  const titleId = useModalTitleId();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loadGuideMarkdown(scenario.guideFile)
      .then((raw) => {
        if (!active) return;
        const { tools, scoring } = splitGuide(injectPodIpsIntoGuide(raw, podId));
        setState(
          which === "tools"
            ? { status: "ready", title: tools?.heading ?? "Tools", body: tools?.body ?? null }
            : { status: "ready", title: "How scoring works", body: scoring }
        );
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [scenario.guideFile, podId, which]);

  const Icon = which === "tools" ? Wrench : Gauge;
  const eyebrow = which === "tools" ? "Tools for this lab" : "Scoring";
  const title = state.status === "ready" ? state.title : which === "tools" ? "Tools" : "How scoring works";

  return (
    <>
      <div className="px-5 sm:px-8 pt-6 pb-4 pr-14 border-b border-border shrink-0">
        <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-brand">
          <Icon size={14} aria-hidden="true" />
          {eyebrow}
        </p>
        <h2 id={titleId} className="mt-1 text-xl sm:text-2xl font-bold text-text-main">
          {title}
        </h2>
      </div>
      <ModalBody>
        {state.status === "loading" && (
          <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading">
            <div className="h-3.5 w-11/12 rounded-full bg-muted" />
            <div className="h-3.5 w-9/12 rounded-full bg-muted" />
            <div className="h-20 w-full rounded-xl bg-muted" />
          </div>
        )}
        {state.status === "ready" &&
          (state.body ? (
            <div className={GUIDE_PROSE_CLASSES}>
              <MarkdownView content={state.body} />
            </div>
          ) : (
            <p className="text-sm text-text-secondary">This lab&apos;s guide doesn&apos;t have this section.</p>
          ))}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-text-secondary">
            Couldn&apos;t load this right now. The same information is in the full guide&apos;s PDF export.
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose} data-autofocus>
          Back to the lab
        </Button>
      </ModalFooter>
    </>
  );
}
