type BadgeVariant = "default" | "success" | "danger" | "warning" | "info" | "brand";

interface BadgeProps {
  variant?: BadgeVariant;
  /** Leading status dot — pairs with the text label, never replaces it. */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-chip text-text-secondary border border-border",
  success: "bg-green-50 text-green-800 border border-green-200",
  danger: "bg-red-50 text-red-800 border border-red-200",
  warning: "bg-amber-50 text-amber-900 border border-amber-200",
  info: "bg-blue-50 text-blue-800 border border-blue-200",
  brand: "bg-brand/10 text-brand border border-brand/20",
};

const dotClasses: Record<BadgeVariant, string> = {
  default: "bg-text-faint",
  success: "bg-success",
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-blue-600",
  brand: "bg-brand",
};

export function Badge({ variant = "default", dot = false, className = "", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${variantClasses[variant]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[variant]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}
