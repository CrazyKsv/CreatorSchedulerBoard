/** @type {import('tailwindcss').Config} */
// Neon Studio — dark-mode token extension.
// Drop-in replacement for frontend/tailwind.config.js. The original warm
// `accent` / `ink` / `surface` / `border` palettes are removed — Neon Studio
// is dark-mode-only, and keeping both palettes live will cause Tailwind's
// JIT to ship dead classes and confuse component authors about which token
// system is canonical.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Canvas / surfaces
        bg:       "#0d0e14",   // page background
        "bg-2":   "#10111a",   // section bg
        panel:    "#151723",   // card
        "panel-2":"#1c1f2d",   // tool row / raised
        // Hairlines
        line:     "rgba(255,255,255,.08)",
        "line-2": "rgba(255,255,255,.14)",
        // Text
        ink: {
          DEFAULT: "#f1f2f7",
          2:       "#c8cad4",
          muted:   "#8a8d99",
          faint:   "#575a66",
        },
        // Signal colors
        cyan:     "#5eead4",
        magenta:  "#ff5eb5",
        violet:   "#a594ff",
        amber:    "#ffb547",
        "amber-soft": "#ffd17a",
        ok:       "#5eead4",
        danger:   "#ff6a82",
        // Platform brand (keep in sync with src/components/utils.js PLATFORMS)
        platform: {
          instagram: "#FF4D8F",
          tiktok:    "#25F4EE",
          twitter:   "#ffffff",
          youtube:   "#FF0033",
          linkedin:  "#0A66C2",
        },
      },
      fontFamily: {
        // Editorial — headers, status numbers, magazine serif
        serif: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        // UI — body + buttons
        sans: [
          '"Inter"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        // Display — section eyebrows, alt headers (optional)
        display: ['"Space Grotesk"', '"Inter"', "sans-serif"],
        // Metadata — timestamps, station labels, tool-call output
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        // Neon glow presets — composable: shadow-glow-cyan + shadow-lift
        "glow-cyan":    "0 0 0 1px rgba(94,234,212,.25), 0 0 24px rgba(94,234,212,.18)",
        "glow-magenta": "0 0 0 1px rgba(255,94,181,.25), 0 0 24px rgba(255,94,181,.18)",
        "glow-violet":  "0 0 0 1px rgba(165,148,255,.25), 0 0 24px rgba(165,148,255,.18)",
        "glow-amber":   "0 0 0 1px rgba(255,181,71,.35), 0 0 28px rgba(255,181,71,.28)",
        "glow-ok":      "0 0 0 1px rgba(94,234,212,.30), 0 0 18px rgba(94,234,212,.25)",
        "lift":         "0 20px 50px rgba(0,0,0,.55)",
        "overlay":      "0 50px 100px rgba(0,0,0,.70)",
      },
      keyframes: {
        "ns-pulse":      { "0%,100%": { opacity: ".6", transform: "scale(1)" },
                           "50%":     { opacity: "1",  transform: "scale(1.08)" } },
        "ns-rail-flow":  { "0%":   { backgroundPosition: "0 0" },
                           "100%": { backgroundPosition: "60px 0" } },
        "ns-glitch":     { "0%,100%": { opacity: ".5", transform: "translateX(0)" },
                           "50%":     { opacity: "1",  transform: "translateX(2px)" } },
        "ns-cursor":     { "0%,50%": { opacity: "1" },
                           "51%,100%": { opacity: "0" } },
        "ns-fadeslide":  { from: { opacity: "0", transform: "translateY(4px)" },
                           to:   { opacity: "1", transform: "translateY(0)" } },
        "ns-overlay-in": { from: { opacity: "0", transform: "translateY(-8px) scale(.98)" },
                           to:   { opacity: "1", transform: "translateY(0) scale(1)" } },
      },
      animation: {
        "ns-pulse":       "ns-pulse 2s ease-in-out infinite",
        "ns-rail-flow":   "ns-rail-flow 3s linear infinite",
        "ns-glitch":      "ns-glitch 1.2s ease-in-out infinite",
        "ns-cursor":      "ns-cursor 1s steps(1) infinite",
        "ns-fadeslide":   "ns-fadeslide .4s ease-out both",
        "ns-overlay-in":  "ns-overlay-in .18s cubic-bezier(.2,.9,.25,1) both",
      },
      letterSpacing: {
        "wider-2": "0.14em",
        "wider-3": "0.18em",
      },
    },
  },
  plugins: [],
};
