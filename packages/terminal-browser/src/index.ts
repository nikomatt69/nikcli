export { detectTerminalCapabilities, normalizeWebUrl } from "./capabilities"
export { createTerminalBrowserSession } from "./session"
export { AnsiTerminalRendererBackend, linesFromNativeCellBuffer } from "./renderer/ansi/backend"
export { BitmapTerminalRendererBackend } from "./renderer/bitmap/backend"
export type {
  BitmapProtocol,
  BrowserEngineAdapter,
  BrowserFrame,
  BrowserKeyboardEvent,
  BrowserMouseEvent,
  BrowserState,
  BrowserViewport,
  CreateTerminalBrowserSessionOptions,
  TerminalBrowserSession,
  TerminalBrowserSnapshot,
  TerminalCapabilities,
  TerminalColorMode,
  TerminalLine,
  TerminalRendererBackend,
  TerminalSegment,
  TerminalViewport,
} from "./types"
