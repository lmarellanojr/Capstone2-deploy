"use client";

import React, { useEffect, useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Pod } from "@/lib/api";
import { injectPodIpsIntoGuide } from "@/lib/podIps";
import { Scenario } from "@/hooks/useScenarios";

interface GuideViewProps {
  pod: Pod;
  scenario: Scenario;
}

function GuideViewComponent({ pod, scenario }: GuideViewProps) {
  const [content, setContent] = useState<string>("Loading guide...");

  useEffect(() => {
    let active = true;
    if (!scenario.guideFile) {
      setContent("No guide available for this scenario.");
      return;
    }

    fetch(`/scenarios/${scenario.guideFile}`)
      .then((res) => {
        if (!res.ok) throw new Error("Guide not found");
        return res.text();
      })
      .then((text) => {
        if (!active) return;
        setContent(injectPodIpsIntoGuide(text, pod.pod_id));
      })
      .catch((err) => {
        if (!active) return;
        setContent("Error loading guide: " + err.message);
      });

    return () => {
      active = false;
    };
  }, [scenario.guideFile, pod.pod_id]);

  return (
    <div className="prose prose-sm max-w-none p-2 h-full overflow-y-auto prose-headings:text-text-main prose-p:text-text-secondary prose-strong:text-text-main prose-code:text-brand prose-code:bg-muted prose-code:px-1 prose-code:rounded">
      <ReactMarkdown
        remarkPlugins={[require('remark-gfm')]}
        components={{
          table: ({node, ...props}) => (
            <div className="table-container w-full overflow-x-auto my-4">
              <table className="w-full border-collapse min-w-[480px]" {...props} />
            </div>
          ),
          th: ({node, ...props}) => (
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap" {...props} />
          ),
          td: ({node, ...props}) => (
            <td className="px-3 py-2 border-t whitespace-nowrap" {...props} />
          ),
        }}
        rehypePlugins={[rehypeSanitize]}
      >{content}</ReactMarkdown>
    </div>
  );
}

export const GuideView = memo(GuideViewComponent);