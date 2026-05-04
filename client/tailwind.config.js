/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "app-bg": "rgb(var(--color-app-bg) / <alpha-value>)",
        "app-bg-warm": "rgb(var(--color-app-bg-warm) / <alpha-value>)",
        "app-text": "rgb(var(--color-app-text) / <alpha-value>)",
        "app-muted": "rgb(var(--color-app-muted) / <alpha-value>)",
        "app-border": "rgb(var(--color-app-border) / <alpha-value>)",
        "surface-base": "rgb(var(--color-surface-base) / <alpha-value>)",
        "surface-soft": "rgb(var(--color-surface-soft) / <alpha-value>)",
        "surface-inverted": "rgb(var(--color-surface-inverted) / <alpha-value>)",
        "accent-lime": "rgb(var(--color-accent-lime) / <alpha-value>)",
        "accent-forest": "rgb(var(--color-accent-forest) / <alpha-value>)",
        "accent-coral": "rgb(var(--color-accent-coral) / <alpha-value>)",
        "status-success": "rgb(var(--color-status-success) / <alpha-value>)",
        "status-danger": "rgb(var(--color-status-danger) / <alpha-value>)",
        "status-neutral": "rgb(var(--color-status-neutral) / <alpha-value>)",
        overlay: "rgb(var(--color-overlay) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI"', '"Helvetica Neue"', "sans-serif"],
      },
      fontSize: {
        hero: ["clamp(2.75rem, 6vw, 4.75rem)", { lineHeight: "0.95", letterSpacing: "-0.04em" }],
      },
      borderRadius: {
        pill: "999px",
        card: "1.5rem",
        panel: "2rem",
        tile: "1.25rem",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        card: "var(--shadow-card)",
      },
      backdropBlur: {
        chrome: "18px",
      },
      letterSpacing: {
        label: "0.22em",
        tag: "0.2em",
      },
    },
  },
  plugins: [],
};
