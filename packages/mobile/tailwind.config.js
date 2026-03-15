/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#06121f",
        surface: "#0d1b2a",
        panel: "#12263a",
        border: "#1d344d",
        accent: "#38bdf8",
        "accent-strong": "#0ea5e9",
        "accent-light": "#7dd3fc",
        muted: "#89a3bf",
        ink: "#e6eef8",
        soft: "#94a8bd",
        "user-bubble": "#11324d",
        "assistant-bubble": "#0c1826",
        success: "#22c55e",
        danger: "#ef4444",
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
