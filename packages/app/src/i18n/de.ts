import type { Translations } from "./types"

export const de: Translations = {
  home: {
    title: "NikCLI",
    welcome: "Willkommen bei NikCLI",
    description: "Ihr KI-gestützter Programmierassistent",
    startSession: "Sitzung Starten",
    settings: "Einstellungen",
  },
  session: {
    title: "Sitzung",
    editorPlaceholder: "Geben Sie Ihren Code hier ein...",
    noActiveSession: "Keine aktive Sitzung",
    createNewSession: "Erstellen Sie eine neue Sitzung, um zu beginnen",
  },
  settings: {
    title: "Einstellungen",
    appearance: "Erscheinungsbild",
    editor: "Editor",
    theme: "Thema",
    light: "Hell",
    dark: "Dunkel",
    system: "System",
    fontSize: "Schriftgröße",
    wordWrap: "Zeilenumbruch",
    showLineNumbers: "Zeilennummern anzeigen",
  },
  sidebar: {
    sessions: "Sitzungen",
    noSessions: "Keine Sitzungen",
    newSession: "Neue Sitzung",
  },
  prompt: {
    placeholder: "Fragen Sie etwas...",
    send: "Senden",
    processing: "Verarbeitung...",
    history: "Verlauf",
    messages: "Nachrichten",
  },
  status: {
    connected: "Verbunden",
    disconnected: "Getrennt",
    sessions: "Sitzungen",
  },
  auth: {
    login: "Anmelden",
    logout: "Abmelden",
  },
  error: {
    title: "Fehler",
    notFound: "Seite nicht gefunden",
    goHome: "Zurück zur Startseite",
  },
}
