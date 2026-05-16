// Mirrors the client palette from client/src/index.css and client/tailwind.config.js
// so transactional emails feel like the same product even without Tailwind at render time.
export const emailTheme = {
  brandName: "talo",
  colors: {
    appBg: "#f8f5ef",
    appBgWarm: "#fffdf8",
    appText: "#1d2a2f",
    appMuted: "#5d6b71",
    appBorder: "#d8d1c4",
    surfaceBase: "#ffffff",
    surfaceSoft: "#efe6d8",
    accentLime: "#6fdd71",
    accentForest: "#0f6d56",
    accentCoral: "#ff7b54",
  },
  fontFamily: `"Inter", "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`,
  radius: {
    pill: "999px",
    card: "18px",
    tile: "12px",
  },
  shadow: {
    card: "0 1px 2px rgba(14, 34, 28, 0.04), 0 4px 12px rgba(14, 34, 28, 0.06)",
    soft: "0 8px 24px rgba(14, 34, 28, 0.08)",
  },
} as const;
