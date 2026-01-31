/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        terminal: {
          bg: "rgb(var(--terminal-bg) / <alpha-value>)",
          panel: "rgb(var(--terminal-panel) / <alpha-value>)",
          border: "rgb(var(--terminal-border) / <alpha-value>)",
          text: "rgb(var(--terminal-text) / <alpha-value>)",
          muted: "rgb(var(--terminal-muted) / <alpha-value>)",
          accent: "rgb(var(--terminal-accent) / <alpha-value>)",
          error: "rgb(var(--terminal-error) / <alpha-value>)",
          warning: "rgb(var(--terminal-warning) / <alpha-value>)",
        },
      },
      animation: {
        cursor: "cursor 1s step-end infinite",
      },
      keyframes: {
        cursor: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
}
