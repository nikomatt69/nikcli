export type TerminalColorMode = "truecolor" | "ansi256" | "mono"
export type BitmapProtocol = "none" | "kitty" | "iterm" | "sixel"

export type TerminalCapabilities = {
  colorMode: TerminalColorMode
  trueColor: boolean
  supportsUnicodeBlocks: boolean
  bitmapProtocol: BitmapProtocol
  supportsBitmap: boolean
  term: string
  termProgram: string
}

export type TerminalViewport = {
  columns: number
  rows: number
}

export type BrowserViewport = TerminalViewport & {
  pixelWidth: number
  pixelHeight: number
}

export type BrowserFrame = {
  format: "jpeg" | "png"
  data: Uint8Array
  timestamp: number
}

export type RgbaFrame = {
  data: Uint8ClampedArray
  width: number
  height: number
  timestamp: number
}

export type BrowserState = {
  url: string
  title: string
  loading: boolean
  error: string | null
  canGoBack: boolean
  canGoForward: boolean
  ready: boolean
}

export type BrowserMouseButton = "left" | "middle" | "right"
export type BrowserMouseEvent =
  | { type: "down" | "up" | "move"; column: number; row: number; button?: BrowserMouseButton }
  | { type: "scroll"; column: number; row: number; deltaX: number; deltaY: number }

export type BrowserKeyboardEvent = {
  key: string
  text?: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}

export type TerminalSegment = {
  text: string
  fg: string
  bg: string
}

export type TerminalLine = {
  segments: TerminalSegment[]
}

export type TerminalRenderOutput = {
  lines: TerminalLine[]
  dirtyRows: number[]
}

export interface BrowserEngineAdapter {
  start(): Promise<void>
  goto(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  setViewport(viewport: BrowserViewport): Promise<void>
  sendMouse(event: BrowserMouseEvent & { pixelX: number; pixelY: number }): Promise<void>
  sendKeyboard(event: BrowserKeyboardEvent): Promise<void>
  captureFrames(onFrame: (frame: BrowserFrame) => void): Promise<void>
  getState(): BrowserState
  subscribe(listener: (state: BrowserState) => void): () => void
  dispose(): Promise<void>
}

export interface TerminalRendererBackend {
  init(capabilities: TerminalCapabilities, viewport: BrowserViewport): void
  renderFrame(frame: RgbaFrame): TerminalRenderOutput
  resize(viewport: BrowserViewport): void
  dispose(): void
}

export type TerminalBrowserSnapshot = BrowserState & {
  lines: TerminalLine[]
  terminalViewport: TerminalViewport
  browserViewport: BrowserViewport
  capabilities: TerminalCapabilities
}

export interface TerminalBrowserSession {
  getSnapshot(): TerminalBrowserSnapshot
  subscribe(listener: (snapshot: TerminalBrowserSnapshot) => void): () => void
  goto(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  setViewport(viewport: TerminalViewport): Promise<void>
  sendMouse(event: BrowserMouseEvent): Promise<void>
  sendKeyboard(event: BrowserKeyboardEvent): Promise<void>
  dispose(): Promise<void>
}

export type CreateTerminalBrowserSessionOptions = {
  initialUrl?: string
  browserPath?: string
  capabilities?: TerminalCapabilities
  viewport?: Partial<TerminalViewport>
}
