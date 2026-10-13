"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { copyToClipboard } from "@/lib/copyToClipboard";

export const CREDENTIAL_HANDOFF_TIMEOUT_MS = 2 * 60 * 1000;

export interface CredentialHandoff {
  username: string;
  password: string;
  temporary: boolean;
}

interface CredentialHandoffModalProps {
  credentials: CredentialHandoff | null;
  onClose: () => void;
}

export function CredentialHandoffModal({ credentials, onClose }: CredentialHandoffModalProps) {
  const closeRef = useRef(onClose);
  const expiresAtRef = useRef<number | null>(null);
  closeRef.current = onClose;
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!credentials) return;
    setShowPassword(false);
    setCopied(false);
    setExpired(false);
    const expiresAt = Date.now() + CREDENTIAL_HANDOFF_TIMEOUT_MS;
    expiresAtRef.current = expiresAt;
    let timer: number;
    const expireIfDue = () => {
      const remaining = expiresAt - Date.now();
      window.clearTimeout(timer);
      if (remaining <= 0) {
        setExpired(true);
        closeRef.current();
      } else timer = window.setTimeout(expireIfDue, remaining);
    };
    timer = window.setTimeout(expireIfDue, CREDENTIAL_HANDOFF_TIMEOUT_MS);
    document.addEventListener("visibilitychange", expireIfDue);
    window.addEventListener("focus", expireIfDue);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", expireIfDue);
      window.removeEventListener("focus", expireIfDue);
      expiresAtRef.current = null;
    };
  }, [credentials]);

  const copyCredentials = async () => {
    if (!credentials) return;
    if (expiresAtRef.current !== null && Date.now() >= expiresAtRef.current) {
      setExpired(true);
      closeRef.current();
      return;
    }
    const signInUrl = `${window.location.origin}/login`;
    setCopied(await copyToClipboard(
      `Username: ${credentials.username}\nPassword: ${credentials.password}\nSign in: ${signInUrl}`
    ));
  };

  return (
    <Modal isOpen={credentials !== null && !expired} onClose={onClose}>
      {credentials && !expired && (
        <>
          <ModalHeader title="Share account details securely" />
          <ModalBody className="space-y-4">
            <p className="text-sm text-text-secondary">
              These details stay in this page for up to two minutes. Share them only through your approved secure channel.
            </p>
            <div className="rounded-lg border border-border bg-secondary p-3 text-sm">
              <p><span className="font-semibold">Username:</span> {credentials.username}</p>
              <p className="mt-2 flex items-center gap-2">
                <span className="font-semibold">Password:</span>
                <code className="font-mono">{showPassword ? credentials.password : "••••••••••••"}</code>
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="rounded p-1 text-text-muted hover:text-text-main focus-ring"
                >
                  {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                </button>
              </p>
              <p className="mt-2"><span className="font-semibold">Sign in:</span> /login</p>
              {credentials.temporary && (
                <p className="mt-2 text-xs text-text-muted">They must choose a new password at first sign-in.</p>
              )}
            </div>
            <p className="text-xs text-text-muted">
              Copy is a deliberate action. Avoid shared computers and clear the clipboard after transferring the details.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>Close and clear</Button>
            <Button variant="primary" onClick={() => void copyCredentials()}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? "Copied" : "Copy credentials"}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
