// Types for the i18n system
export interface Translations {
  home: {
    title: string
    welcome: string
    description: string
    startSession: string
    settings: string
  }
  session: {
    title: string
    editorPlaceholder: string
    noActiveSession: string
    createNewSession: string
    startPrompt: string
  }
  settings: {
    title: string
    appearance: string
    editor: string
    theme: string
    light: string
    dark: string
    system: string
    fontSize: string
    wordWrap: string
    showLineNumbers: string
    server: string
    serverUrl: string
    serverDirectory: string
    serverDefault: string
    serverStatus: string
    auth: string
  }
  sidebar: {
    sessions: string
    noSessions: string
    newSession: string
  }
  prompt: {
    placeholder: string
    send: string
    processing: string
    history: string
    messages: string
  }
  status: {
    connected: string
    disconnected: string
    sessions: string
  }
  auth: {
    login: string
    logout: string
    username: string
    password: string
    connect: string
    connecting: string
    invalid: string
    connectedAs: string
    loginHint: string
  }
  error: {
    title: string
    notFound: string
    goHome: string
  }
}

export type Language = "en" | "it" | "es" | "fr" | "de"

export type TranslationKey =
  | "home.title"
  | "home.welcome"
  | "home.description"
  | "home.startSession"
  | "home.settings"
  | "session.title"
  | "session.editorPlaceholder"
  | "session.noActiveSession"
  | "session.createNewSession"
  | "session.startPrompt"
  | "settings.title"
  | "settings.appearance"
  | "settings.editor"
  | "settings.theme"
  | "settings.light"
  | "settings.dark"
  | "settings.system"
  | "settings.fontSize"
  | "settings.wordWrap"
  | "settings.showLineNumbers"
  | "settings.server"
  | "settings.serverUrl"
  | "settings.serverDirectory"
  | "settings.serverDefault"
  | "settings.serverStatus"
  | "settings.auth"
  | "sidebar.sessions"
  | "sidebar.noSessions"
  | "sidebar.newSession"
  | "prompt.placeholder"
  | "prompt.send"
  | "prompt.processing"
  | "prompt.history"
  | "prompt.messages"
  | "status.connected"
  | "status.disconnected"
  | "status.sessions"
  | "auth.login"
  | "auth.logout"
  | "auth.username"
  | "auth.password"
  | "auth.connect"
  | "auth.connecting"
  | "auth.invalid"
  | "auth.connectedAs"
  | "auth.loginHint"
  | "error.title"
  | "error.notFound"
  | "error.goHome"
