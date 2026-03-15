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
      },
      borderRadius: {
        xl: "20px",
        "2xl": "24px",
        "3xl": "30px",
        "4xl": "34px",
      },
      boxShadow: {
        "space-sm": "0 10px 18px rgba(2, 6, 23, 0.16)",
        "space-md": "0 18px 30px rgba(2, 6, 23, 0.22)",
        "glow-accent": "0 0 0 1px rgba(56, 189, 248, 0.14), 0 16px 30px rgba(56, 189, 248, 0.12)",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
    },
  },
  plugins: [],
}
