const TIPS = [
  "Open Missions in Tools to run multi-milestone work on the linked host.",
  "Loops run recurring stages; Routines are simpler scheduled prompts.",
  "Tap a session title to inspect todos, MCP, LSP, and files.",
  "Set a session wallpaper in Tools → Appearance. Reduced transparency hides it.",
  "Turn on math rendering in Appearance to show LaTeX in assistant replies.",
  "Brain consolidates recent sessions into long-term memory on the host.",
  "Chatbots start and stop Discord, Slack, and other host connectors.",
  "Use the command palette in a session to jump to Missions, Brain, or wallpaper.",
  "Host tools (browser, computer, Island) report the linked machine, not this phone.",
]

export function nextTip(seed = Date.now()) {
  return TIPS[Math.abs(seed) % TIPS.length] ?? TIPS[0]
}
