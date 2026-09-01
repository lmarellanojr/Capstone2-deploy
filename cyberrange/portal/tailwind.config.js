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
        brand: "var(--color-bg-accent)",
        "brand-hover": "var(--color-bg-accent-hover)",
        border: "var(--color-border-default)",
        "text-main": "var(--color-text-primary)",
        "text-muted": "var(--color-text-secondary)",
        "text-on-accent": "var(--color-text-on-accent)",
        danger: "#b91c1c",
        success: "#15803d",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
