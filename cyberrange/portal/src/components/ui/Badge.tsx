interface BadgeProps {
  variant?: "default" | "success" | "danger" | "warning" | "info" | "brand";
  children: React.ReactNode;
}

export function Badge({ variant = "default", children }: BadgeProps) {
  const variantClasses = {
    default: "bg-chip text-text-secondary border border-border",
    success: "bg-green-100 text-green-800 border border-green-200",
    danger: "bg-red-100 text-red-800 border border-red-200",
    warning: "bg-amber-100 text-amber-900 border border-amber-200",
    info: "bg-blue-100 text-blue-800 border border-blue-200",
    brand: "bg-brand/10 text-brand border border-brand/20",
  };

  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${variantClasses[variant]}`}
    >
      {children}
    </span>
  );
}