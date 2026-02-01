const env = import.meta.env

export const NIKCLI_URL = env.VITE_NIKCLI_URL || env.VITE_API_URL || "http://localhost:4096"
export const NIKCLI_USERNAME = env.VITE_NIKCLI_USERNAME || env.VITE_API_USERNAME || ""
export const NIKCLI_PASSWORD = env.VITE_NIKCLI_PASSWORD || env.VITE_API_PASSWORD || ""
export const NIKCLI_DIRECTORY = env.VITE_NIKCLI_DIRECTORY || ""
export const APP_VERSION = env.VITE_APP_VERSION || "1.0.0"
export const SUPPORTED_LANGUAGES = ["en", "it", "es", "fr", "de"] as const
export const DEFAULT_LANGUAGE = "en"
export const DEFAULT_THEME = "system"
export const SIDEBAR_WIDTH = 280
export const PANEL_HEIGHT = 200
