/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-bg-canvas)",
        secondary: "var(--color-bg-surface)",
        "secondary-hover": "var(--color-bg-inset)",
        muted: "var(--color-bg-inset)",
        chip: "var(--color-bg-chip)",
        // Channel form (not the plain hex var) so opacity modifiers such as
        // bg-brand/10, border-brand/40 and ring-brand/20 actually generate CSS.
        // Tailwind cannot apply /NN to a bare var(--hex); those classes used to
        // compile to nothing. Same crimson as --color-bg-accent.
        brand: "rgb(var(--color-bg-accent-rgb) / <alpha-value>)",
        "brand-hover": "var(--color-bg-accent-hover)",
        border: "var(--color-border-default)",
        "border-strong": "var(--color-border-strong)",
        "text-main": "var(--color-text-primary)",
        "text-muted": "var(--color-text-secondary)",
        // `text-text-secondary` is used across the app but was never mapped,
        // so it silently inherited the primary text color.
        "text-secondary": "var(--color-text-secondary)",
        "text-faint": "var(--color-text-muted)",
        "text-on-accent": "var(--color-text-on-accent)",
        "terminal-bg": "var(--color-terminal-bg)",
        danger: "#b91c1c",
        success: "#15803d",
        warning: "#b45309",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        overlay: "var(--shadow-overlay)",
      },
      keyframes: {
        "overlay-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "dialog-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "overlay-in": "overlay-in 150ms ease-out",
        "dialog-in": "dialog-in 180ms ease-out",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
