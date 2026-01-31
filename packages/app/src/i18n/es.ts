import type { Translations } from "./types"

export const es: Translations = {
  home: {
    title: "NikCLI",
    welcome: "Bienvenido a NikCLI",
    description: "Tu asistente de programación con IA",
    startSession: "Iniciar Sesión",
    settings: "Configuración",
  },
  session: {
    title: "Sesión",
    editorPlaceholder: "Escribe tu código aquí...",
    noActiveSession: "No hay sesión activa",
    createNewSession: "Crea una nueva sesión para comenzar",
  },
  settings: {
    title: "Configuración",
    appearance: "Apariencia",
    editor: "Editor",
    theme: "Tema",
    light: "Claro",
    dark: "Oscuro",
    system: "Sistema",
    fontSize: "Tamaño de Fuente",
    wordWrap: "Ajuste de Línea",
    showLineNumbers: "Mostrar Números de Línea",
  },
  sidebar: {
    sessions: "Sesiones",
    noSessions: "No hay sesiones",
    newSession: "Nueva Sesión",
  },
  prompt: {
    placeholder: "Pregunta cualquier cosa...",
    send: "Enviar",
    processing: "Procesando...",
    history: "Historial",
    messages: "Mensajes",
  },
  status: {
    connected: "Conectado",
    disconnected: "Desconectado",
    sessions: "sesiones",
  },
  auth: {
    login: "Iniciar Sesión",
    logout: "Cerrar Sesión",
  },
  error: {
    title: "Error",
    notFound: "Página no encontrada",
    goHome: "Ir a Inicio",
  },
}
