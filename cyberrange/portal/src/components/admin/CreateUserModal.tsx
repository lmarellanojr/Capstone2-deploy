"use client";

import { useEffect, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import type { AdminUser, AppRole, CreateUserInput } from "@/lib/api";
import {
  APP_ROLES,
  toCreateUserInput,
  validateCreateUser,
  type CreateUserErrors,
  type CreateUserForm,
} from "@/lib/adminUserValidation";

const EMPTY: CreateUserForm = {
  username: "",
  email: "",
  first_name: "",
  last_name: "",
  role: "student",
  password: "",
  temporary_password: true,
};

const ROLE_LABEL: Record<AppRole, string> = { student: "Student", instructor: "Instructor", admin: "Admin" };

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rejects with a user-safe Error (e.g. "Username or email already exists"). */
  onCreate: (input: CreateUserInput) => Promise<AdminUser>;
  onCreated: (user: AdminUser) => void;
}

export function CreateUserModal({ isOpen, onClose, onCreate, onCreated }: CreateUserModalProps) {
  const uid = useId();
  const [form, setForm] = useState<CreateUserForm>(EMPTY);
  const [errors, setErrors] = useState<CreateUserErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(EMPTY);
    setErrors({});
    setServerError(null);
    setSaving(false);
    setShowPassword(false);
  }, [isOpen]);

  const set = <K extends keyof CreateUserForm>(key: K, value: CreateUserForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Re-validate only a field that is already showing an error.
    if (errors[key]) setErrors((e) => ({ ...e, [key]: validateCreateUser({ ...form, [key]: value })[key] }));
  };

  const handleSubmit = async () => {
    const found = validateCreateUser(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setServerError(null);
    try {
      const created = await onCreate(toCreateUserInput(form));
      onCreated(created);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Couldn't create the user.");
      setSaving(false);
    }
  };

  const input = (bad?: string) =>
    `w-full rounded-lg border bg-secondary px-3 py-2 text-sm text-text-main placeholder:text-text-faint transition focus:outline-none focus:ring-2 focus:ring-brand/20 ${
      bad ? "border-red-300 focus:border-red-400" : "border-border focus:border-brand/40"
    }`;

  const field = (key: keyof CreateUserForm, label: string, opts: { required?: boolean; hint?: string } = {}) => (
    <label htmlFor={`${uid}-${key}`} className="block text-sm font-semibold text-text-main mb-1">
      {label} {opts.required ? <span className="text-danger">*</span> : <span className="font-normal text-text-muted">(optional)</span>}
    </label>
  );

  const errorText = (key: keyof CreateUserForm, hint?: string) =>
    errors[key] ? (
      <p id={`${uid}-${key}-msg`} className="mt-1 text-xs text-danger">
        {errors[key]}
      </p>
    ) : hint ? (
      <p id={`${uid}-${key}-msg`} className="mt-1 text-xs text-text-muted">
        {hint}
      </p>
    ) : null;

  return (
    <Modal isOpen={isOpen} onClose={saving ? () => {} : onClose} size="lg">
      <ModalHeader title="Create user" />
      <ModalBody>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          noValidate
        >
          <div>
            {field("username", "Username", { required: true })}
            <input
              id={`${uid}-username`}
              data-autofocus
              autoComplete="off"
              value={form.username}
              onChange={(e) => set("username", e.target.value.toLowerCase())}
              aria-invalid={!!errors.username}
              aria-describedby={`${uid}-username-msg`}
              className={input(errors.username)}
              placeholder="jdelacruz"
            />
            {errorText("username", "Lower-case. Becomes the student's lab ID, so it can't be changed later.")}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {field("first_name", "First name")}
              <input
                id={`${uid}-first_name`}
                value={form.first_name}
                onChange={(e) => set("first_name", e.target.value)}
                aria-invalid={!!errors.first_name}
                className={input(errors.first_name)}
              />
              {errorText("first_name")}
            </div>
            <div>
              {field("last_name", "Last name")}
              <input
                id={`${uid}-last_name`}
                value={form.last_name}
                onChange={(e) => set("last_name", e.target.value)}
                aria-invalid={!!errors.last_name}
                className={input(errors.last_name)}
              />
              {errorText("last_name")}
            </div>
          </div>

          <div>
            {field("email", "Email")}
            <input
              id={`${uid}-email`}
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={`${uid}-email-msg`}
              className={input(errors.email)}
            />
            {errorText("email")}
          </div>

          <fieldset>
            <legend className="block text-sm font-semibold text-text-main mb-2">
              Role <span className="text-danger">*</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {APP_ROLES.map((role) => (
                <label
                  key={role}
                  className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30 ${
                    form.role === role ? "border-brand bg-brand/10 text-brand" : "border-border text-text-muted hover:text-text-main"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${uid}-role`}
                    value={role}
                    checked={form.role === role}
                    onChange={() => set("role", role)}
                    className="sr-only"
                  />
                  {ROLE_LABEL[role]}
                </label>
              ))}
            </div>
            {errorText("role")}
          </fieldset>

          <div>
            {field("password", "Initial password", { required: true })}
            <div className="relative">
              <input
                id={`${uid}-password`}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                aria-invalid={!!errors.password}
                aria-describedby={`${uid}-password-msg`}
                className={`${input(errors.password)} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-main focus-ring"
              >
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
            {errorText("password", "8–128 characters. Keycloak's password policy may add rules.")}
          </div>

          <label className="flex items-start gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={form.temporary_password}
              onChange={(e) => set("temporary_password", e.target.checked)}
              className="mt-0.5 rounded border-border text-brand focus:ring-brand/30"
            />
            <span>
              Require a new password at first sign-in <span className="text-text-muted">(recommended)</span>
            </span>
          </label>

          {serverError && (
            <div role="alert" className="alert-error p-3 text-sm">
              {serverError}
            </div>
          )}
          {/* Enter submits from any field. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void handleSubmit()} loading={saving}>
          Create user
        </Button>
      </ModalFooter>
    </Modal>
  );
}
