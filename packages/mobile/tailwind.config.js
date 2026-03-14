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
    },
  },
  plugins: [],
}
