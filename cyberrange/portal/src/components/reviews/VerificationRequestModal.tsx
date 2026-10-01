"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, Send, X } from "lucide-react";
// Direct paths (not the "@/components/ui" barrel): this modal is rendered by
// TerminalView, whose tests replace the barrel with a partial mock.
import { Button } from "@/components/ui/Button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { REQUEST_MAX_CHARS, REQUEST_MIN_CHARS } from "./reviewStatus";
import { ACCEPTED_TYPES, isAcceptedType, MAX_FILES } from "@/lib/imageCompress";

interface VerificationRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** e.g. "Tomcat Manager Exploitation" */
  taskName: string;
  scenarioLabel: string;
  /** Resubmitting a case the instructor returned with RETRY. */
  resubmit?: { feedback: string | null; previousReason: string | null; previousEvidence: string | null };
  /** Resolves on success; rejects with an Error whose message is user-safe. */
  onSubmit: (data: { conflictReason: string; reportText: string; images: File[] }) => Promise<void>;
}

export function VerificationRequestModal({
  isOpen,
  onClose,
  taskName,
  scenarioLabel,
  resubmit,
  onSubmit,
}: VerificationRequestModalProps) {
  const reasonId = useId();
  const evidenceId = useId();
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [shotError, setShotError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shotsId = useId();

  // Fresh form each time it opens; a resubmit starts from what was sent.
  useEffect(() => {
    if (!isOpen) return;
    setReason(resubmit?.previousReason ?? "");
    setEvidence(resubmit?.previousEvidence ?? "");
    setError(null);
    setTouched(false);
    setSubmitting(false);
    setShotError(null);
    setShots((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
  }, [isOpen, resubmit?.previousReason, resubmit?.previousEvidence]);

  // Free preview URLs when the modal unmounts.
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const addShots = (list: FileList | null) => {
    if (!list) return;
    setShotError(null);
    const picked = Array.from(list);
    const bad = picked.filter((f) => !isAcceptedType(f.type));
    const good = picked.filter((f) => isAcceptedType(f.type));
    const room = MAX_FILES - shots.length;
    const taken = good.slice(0, Math.max(0, room));
    const messages: string[] = [];
    if (bad.length) messages.push("Only PNG, JPEG or WebP images can be attached.");
    if (good.length > taken.length) messages.push(`You can attach up to ${MAX_FILES} screenshots.`);
    if (messages.length) setShotError(messages.join(" "));
    if (taken.length) setShots((cur) => [...cur, ...taken.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeShot = (index: number) => {
    setShots((cur) => {
      URL.revokeObjectURL(cur[index].url);
      return cur.filter((_, i) => i !== index);
    });
  };

  const trimmed = reason.trim();
  const reasonError =
    trimmed.length < REQUEST_MIN_CHARS
      ? `Describe what you did in at least ${REQUEST_MIN_CHARS} characters.`
      : reason.length > REQUEST_MAX_CHARS
        ? `Keep it under ${REQUEST_MAX_CHARS.toLocaleString()} characters.`
        : null;
  const evidenceError =
    evidence.length > REQUEST_MAX_CHARS ? `Keep it under ${REQUEST_MAX_CHARS.toLocaleString()} characters.` : null;

  const handleSubmit = async () => {
    setTouched(true);
    if (reasonError || evidenceError) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ conflictReason: trimmed, reportText: evidence.trim(), images: shots.map((s) => s.file) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your request. Please try again.");
      setSubmitting(false);
    }
  };

  const fieldClass = (bad: boolean) =>
    `w-full rounded-lg border bg-secondary px-3 py-2 text-sm text-text-main placeholder:text-text-faint transition focus:outline-none focus:ring-2 focus:ring-brand/20 ${
      bad ? "border-red-300 focus:border-red-400" : "border-border focus:border-brand/40"
    }`;

  return (
    <Modal isOpen={isOpen} onClose={submitting ? () => {} : onClose} size="lg">
      <ModalHeader title={resubmit ? "Send your request again" : "Ask an instructor to check this task"} />
      <ModalBody className="space-y-5">
        <div className="rounded-xl border border-border bg-primary px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{scenarioLabel}</p>
          <p className="font-semibold text-text-main">{taskName}</p>
        </div>

        {resubmit?.feedback && (
          <div className="alert-info p-4 text-sm">
            <p className="font-semibold mb-1">Your instructor said</p>
            <p className="whitespace-pre-wrap">{resubmit.feedback}</p>
          </div>
        )}

        <p className="text-sm text-text-secondary">
          Use this when you believe you completed the task but it wasn&apos;t detected — first try{" "}
          <strong>Manual Check</strong>. An instructor will look at what you send and reply with a decision
          and feedback, which you&apos;ll see on your dashboard.
        </p>

        <div>
          <label htmlFor={reasonId} className="block text-sm font-semibold text-text-main mb-1">
            What command did you use? <span className="text-danger">*</span>
          </label>
          <textarea
            id={reasonId}
            data-autofocus
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && !!reasonError}
            aria-describedby={`${reasonId}-hint`}
            placeholder="e.g. I ran nmap -sV against the meta target and saw Tomcat on 8180, but the task stayed incomplete."
            className={fieldClass(touched && !!reasonError)}
          />
          <p id={`${reasonId}-hint`} className={`mt-1 text-xs ${touched && reasonError ? "text-danger" : "text-text-muted"}`}>
            {touched && reasonError ? reasonError : "Paste the exact command you ran, and what you expected to happen."}
          </p>
        </div>

        <div>
          <label htmlFor={evidenceId} className="block text-sm font-semibold text-text-main mb-1">
            Evidence <span className="font-normal text-text-muted">(optional)</span>
          </label>
          <textarea
            id={evidenceId}
            rows={5}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            aria-invalid={!!evidenceError}
            placeholder="Paste the commands you ran and the key output."
            className={`${fieldClass(!!evidenceError)} font-mono text-xs`}
          />
          {evidenceError && <p className="mt-1 text-xs text-danger">{evidenceError}</p>}
        </div>

        <div>
          <p id={shotsId} className="block text-sm font-semibold text-text-main mb-1">
            Screenshot <span className="font-normal text-text-muted">(Optional, up to {MAX_FILES})</span>
          </p>
          {shots.length > 0 && (
            <ul className="mb-2 grid grid-cols-3 sm:grid-cols-5 gap-2" aria-labelledby={shotsId}>
              {shots.map((s, i) => (
                <li key={s.url} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-primary">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob, not an optimizable asset */}
                  <img src={s.url} alt={`Screenshot ${i + 1}: ${s.file.name}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeShot(i)}
                    disabled={submitting}
                    aria-label={`Remove ${s.file.name}`}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 focus-ring"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="screenshot-input"
            onChange={(e) => addShots(e.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={submitting || shots.length >= MAX_FILES}
            aria-describedby={`${shotsId}-hint`}
          >
            <ImagePlus size={15} aria-hidden="true" />
            Add screenshots
          </Button>
          <p id={`${shotsId}-hint`} className={`mt-1 text-xs ${shotError ? "text-danger" : "text-text-muted"}`}>
            {shotError ??
              "PNG, JPEG or WebP. Big images are shrunk automatically. Don't include passwords or personal info."}
          </p>
        </div>

        {error && (
          <div role="alert" className="alert-error p-3 text-sm">
            {error}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} loading={submitting}>
          {!submitting && <Send size={15} aria-hidden="true" />}
          {resubmit ? "Send again" : "Send request"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
