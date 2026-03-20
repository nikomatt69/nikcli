/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  safelist: ["dark"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--color-background) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        "accent-strong": "rgb(var(--color-accent-strong) / <alpha-value>)",
        "accent-light": "rgb(var(--color-accent-light) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        soft: "rgb(var(--color-soft) / <alpha-value>)",
        "user-bubble": "rgb(var(--color-user-bubble) / <alpha-value>)",
        "assistant-bubble": "rgb(var(--color-assistant-bubble) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        // Glass material system
        "glass-shell": "rgb(var(--color-glass-shell) / <alpha-value>)",
        "glass-shell-strong": "rgb(var(--color-glass-shell-strong) / <alpha-value>)",
        "glass-panel": "rgb(var(--color-glass-panel) / <alpha-value>)",
        "glass-border": "rgb(var(--color-glass-border) / <alpha-value>)",
        "glass-shadow": "rgb(var(--color-glass-shadow) / <alpha-value>)",
        overlay: "rgb(var(--color-overlay) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
        "focus-ring": "rgb(var(--color-focus-ring) / <alpha-value>)",
      },
      borderRadius: {
        xs: "6px",
        sm: "8px",
        DEFAULT: "12px",
        md: "14px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "30px",
        "4xl": "34px",
        pill: "9999px",
      },
      boxShadow: {
        "space-sm": "0 10px 18px rgba(2, 6, 23, 0.16)",
        "space-md": "0 18px 30px rgba(2, 6, 23, 0.22)",
        "glow-accent": "0 0 0 1px rgba(56, 189, 248, 0.14), 0 16px 30px rgba(56, 189, 248, 0.12)",
        glass: "0 2px 8px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.18)",
        soft: "0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)",
        float: "0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)",
        "focus-ring": "0 0 0 3px rgba(14, 165, 233, 0.35)",
        "inner-sm": "inset 0 1px 3px rgba(0, 0, 0, 0.08)",
      },
      // Emil's easing library — from easing.dev + iOS conventions
      transitionTimingFunction: {
        "out-strong": "cubic-bezier(0.23, 1, 0.32, 1)",              // UI interactions, entering
        "in-out-strong": "cubic-bezier(0.77, 0, 0.175, 1)",          // on-screen movement
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",                     // iOS drawer (Ionic)
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",                 // subtle overshoot
        "spring-gentle": "cubic-bezier(0.175, 0.885, 0.32, 1.275)",  // gentle bounce
        bounce: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",            // playful bounce
        snappy: "cubic-bezier(0.2, 0, 0, 1)",                         // crisp, Material-like
      },
      transitionDuration: {
        instant: "50ms",   // micro-feedback, press states
        quick: "100ms",    // button press confirmation
        fast: "150ms",     // tooltips, small popovers
        ui: "200ms",       // standard UI
        enter: "250ms",    // elements entering viewport
        modal: "300ms",    // modals, drawers, sheets
        slow: "500ms",     // deliberate reveals
      },
      // Stagger delays for list choreography (Emil: 30–80ms between items)
      transitionDelay: {
        0: "0ms",
        stagger1: "30ms",
        stagger2: "60ms",
        stagger3: "90ms",
        stagger4: "120ms",
        stagger5: "150ms",
      },
      // Press-state scale tokens (Emil: buttons must feel responsive to press)
      scale: {
        97: "0.97",   // standard button press
        98: "0.98",   // subtle press
        99: "0.99",   // micro press
        101: "1.01",  // subtle lift
        102: "1.02",  // hover lift
        103: "1.03",  // pronounced lift
      },
      opacity: {
        hover: "0.88",            // hover dimming
        "button-pressed": "0.84",
        "button-disabled": "0.58",
        scrim: "0.45",            // modal/drawer scrim
        glass: "0.72",            // glass shell base
      },
      // Blur values tied to glass intensity CSS tokens
      backdropBlur: {
        glass: "16px",
        "glass-strong": "24px",
      },
      // Filter blur for transition masking (Emil: blur masks imperfect crossfades)
      blur: {
        subtle: "2px",
        soft: "4px",
        glass: "16px",
        "glass-strong": "24px",
      },
      // Typography scale
      letterSpacing: {
        display: "-0.03em",   // hero / display text
        heading: "-0.02em",   // section headings
        body: "-0.01em",      // body copy
        normal: "0em",
        caps: "0.08em",       // small caps / labels
        wide: "0.12em",       // spaced caps / badges
      },
      lineHeight: {
        display: "1.1",       // display / hero
        heading: "1.25",      // headings
        snug: "1.375",        // tight body
        body: "1.5",          // default body
        relaxed: "1.625",     // spacious reading
      },
      fontFamily: {
        system: ["-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["Menlo", "Monaco", "Courier New", "monospace"],
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
    },
  },
  plugins: [],
}
