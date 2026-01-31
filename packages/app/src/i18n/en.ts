import type { Translations } from "./types"

export const en: Translations = {
  home: {
    title: "NikCLI",
    welcome: "Welcome to NikCLI",
    description: "Your AI-powered coding assistant",
    startSession: "Start Session",
    settings: "Settings",
  },
  session: {
    title: "Session",
    editorPlaceholder: "Type your code here...",
    noActiveSession: "No active session",
    createNewSession: "Create a new session to get started",
  },
  settings: {
    title: "Settings",
    appearance: "Appearance",
    editor: "Editor",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    fontSize: "Font Size",
    wordWrap: "Word Wrap",
    showLineNumbers: "Show Line Numbers",
  },
  sidebar: {
    sessions: "Sessions",
    noSessions: "No sessions",
    newSession: "New Session",
  },
  prompt: {
    placeholder: "Ask anything...",
    send: "Send",
    processing: "Processing...",
    history: "History",
    messages: "Messages",
  },
  status: {
    connected: "Connected",
    disconnected: "Disconnected",
    sessions: "sessions",
  },
  auth: {
    login: "Login",
    logout: "Logout",
  },
  error: {
    title: "Error",
    notFound: "Page not found",
    goHome: "Go Home",
  },
}
