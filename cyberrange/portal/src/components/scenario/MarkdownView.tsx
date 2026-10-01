"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { CALLOUT_STYLES, CUE_STYLES, classifyCallout, classifyCue } from "./guideCallouts";

// One markdown pipeline for every place a scenario guide is shown — the Guide
// tab, its PDF print copy, and the Big Picture welcome — so they render the
// same markup (sanitized, GFM tables, copyable commands, colour-coded callouts).

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

  // GUIDE-UX-TRIAL: long lab commands (e.g. the Scenario 3 Task 0 SSH line)
  // were wider than the Guide panel, so only horizontal-scrolling revealed
  // the full text -- a student hand-selecting the visible portion could copy
  // an incomplete command. Wrapping here is purely a display fix: the Copy
  // button already reads the full text from `children` via getPlainText()
  // above, independent of how the <pre> renders, so it was never truncated.
  return (
    <div className="group relative not-prose my-4">
      <pre
        {...props}
        className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-terminal-bg px-4 py-3 pr-11 text-sm leading-relaxed text-[color:var(--color-terminal-fg)] shadow-sm"
      >
        {children}
      </pre>
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
        aria-label={copied ? "Copied" : "Copy command"}
        className="absolute right-2 top-2 rounded-md bg-white/10 p-1.5 text-white/70 opacity-0 transition hover:bg-white/20 hover:text-white focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 group-hover:opacity-100"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// A guide blockquote becomes a colour-coded callout card. The bold label the
// author wrote (e.g. "What you're doing & why:") stays as the card's lead, so
// nothing is lost; the colour + icon just make its kind scannable.
function Callout({ children }: { children: React.ReactNode }) {
  const variant = classifyCallout(getPlainText(children).slice(0, 60));
  const s = CALLOUT_STYLES[variant];
  const Icon = s.Icon;
  return (
    <div
      className={`not-prose my-4 flex gap-3 rounded-lg border border-l-4 px-4 py-3 ${s.container}`}
      role="note"
    >
      {/* leading-[1.625] on the icon matches the text's line-height so it sits
          on the first line, not above it. */}
      <Icon size={18} className={`shrink-0 leading-[1.625] ${s.icon}`} aria-hidden="true" style={{ marginTop: "0.15rem" }} />
      {/* flex-col + gap (not space-y): the sr-only label is position:absolute and
          drops out of flex flow, so the first real line starts at the top and
          lines up with the icon. space-y-2 instead margin-topped that line. */}
      <div className="min-w-0 flex flex-col gap-2 text-sm leading-relaxed [&_p]:m-0 [&_a]:underline [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_strong]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5">
        <span className="sr-only">{s.srLabel}: </span>
        {children}
      </div>
    </div>
  );
}

// A line like "**Goal:** find which hosts are alive" becomes a labelled cue
// row with an icon, so during a live lab the eye lands on Goal / Done / Then.
function CueLine({ cue, rest }: { cue: NonNullable<ReturnType<typeof classifyCue>>; rest: React.ReactNode }) {
  const s = CUE_STYLES[cue];
  const Icon = s.Icon;
  return (
    // icon fixed at the first line; label + text flow together and wrap
    // under themselves (not under the icon), so the row never looks detached.
    <p className="my-2 flex items-start gap-2">
      <Icon size={16} className={`${s.icon} mt-0.5 shrink-0`} aria-hidden="true" />
      <span className="min-w-0">
        <span className={`font-semibold ${s.text}`}>{s.label}:</span>
        {rest}
      </span>
    </p>
  );
}

const baseComponents = {
  blockquote: ({ node, children }: any) => <Callout>{children}</Callout>,
  p: ({ node, children, ...props }: any) => {
    const kids = React.Children.toArray(children);
    const first = kids[0];
    if (React.isValidElement(first) && (first as React.ReactElement).type === "strong") {
      const cue = classifyCue(getPlainText((first.props as { children?: React.ReactNode }).children));
      if (cue) return <CueLine cue={cue} rest={kids.slice(1)} />;
    }
    return <p {...props}>{children}</p>;
  },
  table: ({ node, ...props }: any) => (
    <div className="not-prose my-4 w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node, ...props }: any) => <thead className="bg-muted text-left text-text-main" {...props} />,
  th: ({ node, ...props }: any) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold" {...props} />
  ),
  td: ({ node, ...props }: any) => (
    <td
      className="border-t border-border px-3 py-2 align-top text-text-secondary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-brand"
      {...props}
    />
  ),
};

const screenComponents = { ...baseComponents, pre: CodeBlock };
// Print output has no use for an interactive copy button; callouts and tables
// still render (colours carry into the PDF).
const printComponents = baseComponents;

/** The prose styling the in-app guide uses. Body text keeps the typography
 *  plugin's reading gray on purpose: long walkthroughs read better darker
 *  than the UI's secondary-text token. Section (##) headings get a divider,
 *  task (###) headings the brand colour, so the guide is easy to skim. */
export const GUIDE_PROSE_CLASSES = [
  "prose prose-sm max-w-none leading-relaxed",
  "prose-headings:text-text-main prose-headings:font-semibold",
  "prose-h2:mt-8 prose-h2:mb-3 prose-h2:pb-2 prose-h2:text-xl prose-h2:border-b prose-h2:border-border",
  "prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base prose-h3:text-brand",
  "prose-h4:mt-4 prose-h4:mb-1 prose-h4:text-text-main",
  "prose-strong:text-text-main prose-a:text-brand prose-a:font-medium",
  "prose-hr:my-6 prose-hr:border-border",
  "prose-ul:my-3 prose-ol:my-3 prose-li:my-1",
  "prose-code:text-brand prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
].join(" ");

interface MarkdownViewProps {
  content: string;
  /** Print copy: no interactive copy buttons. */
  printable?: boolean;
}

export function MarkdownView({ content, printable = false }: MarkdownViewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={printable ? printComponents : screenComponents}
      rehypePlugins={[rehypeSanitize]}
    >
      {content}
    </ReactMarkdown>
  );
}
