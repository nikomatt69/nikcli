import type { Translations } from "./types"

export const it: Translations = {
  home: {
    title: "NikCLI",
    welcome: "Benvenuto in NikCLI",
    description: "Il tuo assistente di coding basato su AI",
    startSession: "Avvia Sessione",
    settings: "Impostazioni",
  },
  session: {
    title: "Sessione",
    editorPlaceholder: "Scrivi il tuo codice qui...",
    noActiveSession: "Nessuna sessione attiva",
    createNewSession: "Crea una nuova sessione per iniziare",
  },
  settings: {
    title: "Impostazioni",
    appearance: "Aspetto",
    editor: "Editor",
    theme: "Tema",
    light: "Chiaro",
    dark: "Scuro",
    system: "Sistema",
    fontSize: "Dimensione Font",
    wordWrap: "A capo automatico",
    showLineNumbers: "Mostra Numeri di Riga",
  },
  sidebar: {
    sessions: "Sessioni",
    noSessions: "Nessuna sessione",
    newSession: "Nuova Sessione",
  },
  prompt: {
    placeholder: "Chiedi qualsiasi cosa...",
    send: "Invia",
    processing: "Elaborazione...",
    history: "Cronologia",
    messages: "Messaggi",
  },
  status: {
    connected: "Connesso",
    disconnected: "Disconnesso",
    sessions: "sessioni",
  },
  auth: {
    login: "Accedi",
    logout: "Esci",
  },
  error: {
    title: "Errore",
    notFound: "Pagina non trovata",
    goHome: "Torna alla Home",
  },
}
