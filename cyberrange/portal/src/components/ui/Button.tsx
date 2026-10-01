import React from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "outline" | "ghost" | "danger-outline";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

const baseClasses =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2 focus-visible:ring-offset-secondary " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

// Filled variants get a 1px lift + soft shadow on hover (never while disabled);
// quiet variants only change color, so a toolbar of them doesn't jitter.
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-text-on-accent shadow-sm hover:bg-brand-hover enabled:hover:-translate-y-px enabled:hover:shadow-card-hover enabled:active:translate-y-0",
  secondary: "bg-secondary text-text-main border border-border hover:bg-secondary-hover",
  outline: "bg-transparent text-text-main border border-border hover:bg-muted",
  ghost: "bg-transparent text-text-muted hover:text-text-main hover:bg-muted",
  danger:
    "bg-danger text-white shadow-sm hover:bg-red-800 enabled:hover:-translate-y-px enabled:hover:shadow-card-hover enabled:active:translate-y-0",
  "danger-outline": "bg-transparent text-danger border border-red-200 hover:bg-red-50",
  success:
    "bg-success text-white shadow-sm hover:bg-green-800 enabled:hover:-translate-y-px enabled:hover:shadow-card-hover enabled:active:translate-y-0",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3 text-base",
};

/** The Button look for elements that must not be a <button> — e.g. a Next
 *  <Link> (an <a> wrapping a <button> is invalid, doubly-focusable HTML). */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  return `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}
