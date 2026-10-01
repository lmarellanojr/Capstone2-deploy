import { Quote } from "lucide-react";

// Encouragement for students waiting on a lab to start: one fixed quote per
// scenario, chosen to fit what that lab is about. Fixed (not random) because
// the provisioning screen re-renders every second for its elapsed timer, and a
// random pick made the quote change on every tick.
const QUOTES: Record<string, { text: string; author: string }> = {
  // Scenario 1: recon & exploitation, from Kali
  "01": { text: "The quieter you become, the more you are able to hear.", author: "Kali Linux motto" },
  // Scenario 2: SQL injection & XSS
  "06": { text: "Understanding how something breaks is the first step to protecting it.", author: "Anonymous" },
  // Scenario 3: SIEM alert triage
  "09": { text: "It's not about being the smartest in the room. It's about being the most curious.", author: "Anonymous" },
  // Scenario 4: vulnerability hardening
  "11": { text: "Security is a process, not a product.", author: "Bruce Schneier" },
};

const DEFAULT_QUOTE = { text: "Every expert was once a beginner who refused to give up.", author: "Anonymous" };

export function quoteFor(scenarioId: string): { text: string; author: string } {
  return QUOTES[scenarioId] ?? DEFAULT_QUOTE;
}

export function CyberQuote({ scenarioId, className = "" }: { scenarioId: string; className?: string }) {
  const q = quoteFor(scenarioId);
  return (
    <figure className={`flex gap-3 text-sm ${className}`}>
      <Quote size={18} className="shrink-0 mt-0.5 text-text-muted" aria-hidden="true" />
      <div>
        <blockquote className="text-text-main italic">&ldquo;{q.text}&rdquo;</blockquote>
        <figcaption className="mt-1 text-xs text-text-muted">— {q.author}</figcaption>
      </div>
    </figure>
  );
}
