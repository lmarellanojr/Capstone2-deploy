"use client";

import React, { useEffect, useState, memo } from "react";
import { createPortal } from "react-dom";
import { Pod } from "@/lib/api";
import { injectPodIpsIntoGuide } from "@/lib/podIps";
import { Scenario, scenarioDisplayTitle } from "@/hooks/useScenarios";
import { loadGuideMarkdown, splitGuide } from "@/lib/guideSections";
import { MarkdownView, GUIDE_PROSE_CLASSES } from "@/components/scenario/MarkdownView";

interface GuideViewProps {
  pod: Pod;
  scenario: Scenario;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; full: string; guide: string };

// The step-by-step walkthrough. The Big Picture, tools and scoring sections
// are split out (splitGuide) into the welcome modal and the lab's pop-ups.
function GuideViewComponent({ pod, scenario }: GuideViewProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  // Printable copy lives in a portal attached directly to <body> - a sibling
  // of the whole app, not nested inside any of its fixed-height/overflow-auto
  // containers. Print CSS hides everything else and shows only this node.
  // Rendering it inline (inside GuideView's own scroll container) instead
  // would clip to that container's on-screen height: `position: absolute`
  // pulls it out of flow, and Chrome's print engine then only paginates the
  // box's own height - one screen-height "page" - silently dropping the
  // rest of the guide no matter how long it is.
  const [printRoot, setPrintRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.id = "guide-print-root";
    document.body.appendChild(el);
    setPrintRoot(el);
    return () => {
      document.body.removeChild(el);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!scenario.guideFile) {
      setState({ status: "error", message: "No guide available for this scenario." });
      return;
    }
    setState({ status: "loading" });
    loadGuideMarkdown(scenario.guideFile)
      .then((text) => {
        if (!active) return;
        const full = injectPodIpsIntoGuide(text, pod.pod_id);
        setState({ status: "ready", full, guide: splitGuide(full).guide });
      })
      .catch((err: Error) => {
        if (active) setState({ status: "error", message: `Couldn't load the guide: ${err.message}` });
      });
    return () => {
      active = false;
    };
  }, [scenario.guideFile, pod.pod_id]);

  let body: React.ReactNode;
  if (state.status === "loading") {
    body = (
      <div className="space-y-3 animate-pulse p-2" aria-busy="true" aria-label="Loading">
        <div className="h-4 w-2/3 rounded-full bg-muted" />
        <div className="h-3 w-11/12 rounded-full bg-muted" />
        <div className="h-3 w-10/12 rounded-full bg-muted" />
        <div className="h-20 w-full rounded-lg bg-muted" />
      </div>
    );
  } else if (state.status === "error") {
    body = <p className="p-2 text-sm text-text-secondary">{state.message}</p>;
  } else {
    body = <MarkdownView content={state.guide} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className={`${GUIDE_PROSE_CLASSES} p-2 flex-1 overflow-y-auto`}>{body}</div>

      {printRoot &&
        state.status === "ready" &&
        createPortal(
          <div className="prose max-w-none p-10">
            {/* GUIDE-UX-TRIAL / SCEN-UX #116: match the on-screen guide's own
                H1 (also renumbered to Scenario N in the .md source). The PDF
                keeps the complete guide, Big Picture and tools included. */}
            <h1 className="mb-6">{scenarioDisplayTitle(scenario)}</h1>
            <MarkdownView content={state.full} printable />
          </div>,
          printRoot
        )}
    </div>
  );
}

export const GuideView = memo(GuideViewComponent);
