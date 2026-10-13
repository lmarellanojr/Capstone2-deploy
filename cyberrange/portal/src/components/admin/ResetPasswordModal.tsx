"use client";

import { useEffect, useId, useState } from "react";
import { Eye, EyeOff, KeyRound, Wand2 } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
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

  useEffect(() => {
    if (!user) return;
    setPassword("");
    setTemporary(true);
    setShow(false);
    setSaving(false);
    setError(null);
    setTouched(false);
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
      setPassword("");
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't reset the password.";
      setError(`${message} Verify whether the reset completed before sharing this password. For uncertain results, verify the account or issue a fresh reset first. It stays here until you close this form.`);
      setSaving(false);
    }
  };

  const closeModal = () => {
    setPassword("");
    setError(null);
    onClose();
  };

  return (
    <Modal isOpen={user !== null} onClose={saving ? () => {} : closeModal}>
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
                    autoComplete="off"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
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
                  }}
                >
                  <Wand2 size={15} aria-hidden="true" />
                  Generate
                </Button>
              </div>
              <p id={`${uid}-pw-msg`} className={`mt-1 text-xs ${touched && lengthError ? "text-danger" : "text-text-muted"}`}>
                {touched && lengthError ? lengthError : "8–128 characters. No English words of two or more letters anywhere in the password. Not a common password, the username, the email, or one of the last 3 passwords."}
              </p>
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
            <p className="text-xs text-text-muted">
              Passwords are never emailed. Share the new login details through your approved secure channel.
            </p>

            {error && (
              <div role="alert" className="alert-error p-3 text-sm">
                {error}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
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
