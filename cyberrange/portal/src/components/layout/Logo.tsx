import Image from "next/image";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
}

// MMDC shield mark (public/mmdc-shield.png is 512x446, cropped from the
// official lockup without the wordmark so it stays legible at nav sizes).
const SHIELD_W = 512;
const SHIELD_H = 446;

export function Logo({ size = "md", showSubtitle = false }: LogoProps) {
  const markHeights = { sm: 24, md: 32, lg: 40 };
  const textSizes = { sm: "text-sm", md: "text-base", lg: "text-lg" };
  const h = markHeights[size];

  return (
    <div className={`flex items-center gap-3 ${textSizes[size]}`}>
      <Image
        src="/mmdc-shield.png"
        alt=""
        aria-hidden
        width={Math.round((h * SHIELD_W) / SHIELD_H)}
        height={h}
        className="flex-shrink-0"
        priority
      />
      <div className="leading-tight min-w-0">
        <span className="font-bold text-text-main block truncate">MMDC Cyber Range</span>
        {showSubtitle && (
          <span className="text-xs text-text-muted block">Training Platform</span>
        )}
      </div>
    </div>
  );
}
