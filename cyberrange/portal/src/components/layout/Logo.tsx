interface LogoProps {
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
}

export function Logo({ size = "md", showSubtitle = false }: LogoProps) {
  const circleSizes = { sm: "w-7 h-7", md: "w-9 h-9", lg: "w-11 h-11" };
  const textSizes = { sm: "text-sm", md: "text-base", lg: "text-lg" };

  return (
    <div className={`flex items-center gap-3 ${textSizes[size]}`}>
      <div
        className={`${circleSizes[size]} rounded-full bg-brand flex items-center justify-center flex-shrink-0 shadow-sm`}
        aria-hidden
      >
        <span className="text-white font-bold text-xs tracking-tight">MMDC</span>
      </div>
      <div className="leading-tight min-w-0">
        <span className="font-bold text-text-main block truncate">MMDC Cyber Range</span>
        {showSubtitle && (
          <span className="text-xs text-text-muted block">Training Platform</span>
        )}
      </div>
    </div>
  );
}