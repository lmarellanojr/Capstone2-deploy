"use client";

import { useEffect, useId, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Wand2 } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { generatePassword } from "@/lib/generatePassword";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/adminUserValidation";
import type { AdminUser } from "@/lib/api";

interface ResetPasswordModalProps {
  user: AdminUser | null;
  onClose: () => void;
  /** Rejects with a user-safe Error (e.g. the Keycloak password policy said no). */
  onReset: (user: AdminUser, password: string, temporary: boolean) => Promise<void>;
}

export function ResetPasswordModal({ user, onClose, onReset }: ResetPasswordModalProps) {
  const uid = useId();
  const [password, setPassword] = useState("");
  const [temporary, setTemporary] = useState(true);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    setPassword("");
    setTemporary(true);
    setShow(false);
    setSaving(false);
    setError(null);
    setTouched(false);
    setCopied(false);
  }, [user]);

  const lengthError =
    password.length < PASSWORD_MIN
      ? `At least ${PASSWORD_MIN} characters.`
      : password.length > PASSWORD_MAX
        ? `At most ${PASSWORD_MAX} characters.`
        : null;

  const submit = async () => {
    setTouched(true);
    if (!user || lengthError) return;
    setSaving(true);
    setError(null);
    try {
      await onReset(user, password, temporary);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password.");
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={user !== null} onClose={saving ? () => {} : onClose}>
      {user && (
        <>
          <ModalHeader title={`Reset password for ${user.username}`} />
          <ModalBody className="space-y-4">
            <p className="text-sm text-text-secondary">
              They&apos;ll be <strong className="text-text-main">signed out everywhere</strong> right away and must
              use the new password next time.
            </p>

            <div>
              <label htmlFor={`${uid}-pw`} className="block text-sm font-semibold text-text-main mb-1">
                New password <span className="text-danger">*</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id={`${uid}-pw`}
                    data-autofocus
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setCopied(false);
                    }}
                    onBlur={() => setTouched(true)}
                    aria-invalid={touched && !!lengthError}
                    aria-describedby={`${uid}-pw-msg`}
                    className={`w-full rounded-lg border bg-secondary px-3 py-2 pr-10 text-sm font-mono text-text-main focus:outline-none focus:ring-2 focus:ring-brand/20 ${
                      touched && lengthError ? "border-red-300" : "border-border focus:border-brand/40"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-main focus-ring"
                  >
                    {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShow(true);
                    setTouched(false);
                    setCopied(false);
                  }}
                >
                  <Wand2 size={15} aria-hidden="true" />
                  Generate
                </Button>
              </div>
              <p id={`${uid}-pw-msg`} className={`mt-1 text-xs ${touched && lengthError ? "text-danger" : "text-text-muted"}`}>
                {touched && lengthError ? lengthError : "8–128 characters. Not a common password, the username or the email."}
              </p>
              {password && !lengthError && (
                <button
                  type="button"
                  onClick={async () => setCopied(await copyToClipboard(password))}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline rounded focus-ring"
                >
                  <Copy size={12} aria-hidden="true" />
                  {copied ? "Copied" : "Copy password to give to the user"}
                </button>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={temporary}
                onChange={(e) => setTemporary(e.target.checked)}
                className="mt-0.5 rounded border-border text-brand focus:ring-brand/30"
              />
              <span>
                Require them to choose their own password at next sign-in{" "}
                <span className="text-text-muted">(recommended)</span>
              </span>
            </label>

            {error && (
              <div role="alert" className="alert-error p-3 text-sm">
                {error}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} loading={saving}>
              {!saving && <KeyRound size={15} aria-hidden="true" />}
              Reset password
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
