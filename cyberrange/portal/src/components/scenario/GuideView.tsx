"use client";

import React, { useEffect, useState, memo } from "react";
import { createPortal } from "react-dom";
import { Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Pod } from "@/lib/api";
import { injectPodIpsIntoGuide } from "@/lib/podIps";
import { Scenario } from "@/hooks/useScenarios";
import { copyToClipboard } from "@/lib/copyToClipboard";

interface GuideViewProps {
  pod: Pod;
  scenario: Scenario;
}

function getPlainText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getPlainText).join("");
  if (React.isValidElement(node)) {
    return getPlainText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

// Fenced code blocks in the guide are lab commands students need to run
// verbatim (see issue #7 - a missed `exit` command silently failed Manual
// Check). A copy button removes the retyping step that's the usual source
// of typos in commands like `set RHOSTS $TARGET_META`.
function CodeBlock({ children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const text = getPlainText(children).replace(/\n$/, "");

  return (
    <div className="relative">
      <pre {...props}>{children}</pre>
      <button
        type="button"
        onClick={async () => {
          const ok = await copyToClipboard(text);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
        title={copied ? "Copied!" : "Copy to clipboard"}
        aria-label="Copy command"
        className="absolute top-2 right-2 p-1.5 rounded bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

const markdownComponents = {
  table: ({ node, ...props }: any) => (
    <div className="table-container w-full overflow-x-auto my-4">
      <table className="w-full border-collapse min-w-[480px]" {...props} />
    </div>
  ),
  th: ({ node, ...props }: any) => (
    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap" {...props} />
  ),
  td: ({ node, ...props }: any) => (
    <td className="px-3 py-2 border-t whitespace-nowrap" {...props} />
  ),
  pre: CodeBlock,
};

// Print output has no use for an interactive copy button.
const printMarkdownComponents = {
  table: markdownComponents.table,
  th: markdownComponents.th,
  td: markdownComponents.td,
};

function GuideViewComponent({ pod, scenario }: GuideViewProps) {
  const [content, setContent] = useState<string>("Loading guide...");
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
    <div className="h-full flex flex-col">
      <div className="prose prose-sm max-w-none p-2 flex-1 overflow-y-auto prose-headings:text-text-main prose-p:text-text-secondary prose-strong:text-text-main prose-code:text-brand prose-code:bg-muted prose-code:px-1 prose-code:rounded">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          rehypePlugins={[rehypeSanitize]}
        >
          {content}
        </ReactMarkdown>
      </div>

      {printRoot &&
        createPortal(
          <div className="prose max-w-none p-10">
            <h1 className="mb-6">{scenario.name}</h1>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={printMarkdownComponents}
              rehypePlugins={[rehypeSanitize]}
            >
              {content}
            </ReactMarkdown>
          </div>,
          printRoot
        )}
    </div>
  );
}

export const GuideView = memo(GuideViewComponent);
