/**
 * Typed bindings for Bun APIs that `@types/bun` does not declare yet.
 * Call sites go through this module instead of `as any`.
 */

export type ImageFit = "inside" | "fill"

export interface ImagePipeline {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(width: number, height?: number, options?: { fit?: ImageFit; withoutEnlargement?: boolean; filter?: string }): ImagePipeline
  jpeg(options?: { quality?: number; progressive?: boolean }): ImagePipeline
  png(options?: { compressionLevel?: number; palette?: boolean }): ImagePipeline
  webp(options?: { quality?: number; lossless?: boolean }): ImagePipeline
  bytes(): Promise<Uint8Array>
  buffer(): Promise<Buffer>
  dataurl(): Promise<string>
  toBase64(): Promise<string>
  width: number
  height: number
}

export interface ImageConstructor {
  new (
    input: ArrayBufferView | ArrayBuffer | Blob,
    options?: { maxPixels?: number; autoOrient?: boolean },
  ): ImagePipeline
}

export interface ArchiveInstance {
  extract(path: string, options?: { glob?: string | readonly string[] }): Promise<number>
  bytes(): Promise<Uint8Array>
  blob(): Promise<Blob>
  files(glob?: string | readonly string[]): Promise<Map<string, File>>
}

export interface ArchiveConstructor {
  new (
    data:
      | Record<string, string | Blob | ArrayBufferView | ArrayBuffer>
      | Blob
      | ArrayBufferView
      | ArrayBuffer,
    options?: { compress?: "gzip"; level?: number },
  ): ArchiveInstance
}

export interface CronJob {
  readonly cron: string
  stop(): CronJob
  ref(): CronJob
  unref(): CronJob
}

export interface JSONLChunk {
  values: unknown[]
  read: number
  done: boolean
  error: SyntaxError | null
}

type CronFn = {
  (schedule: string, handler: (this: CronJob) => unknown, options?: { tz?: string }): CronJob
  parse(expression: string, relative?: Date | number, options?: { tz?: string }): Date | null
}

type SpawnTerminal = {
  write(data: string | ArrayBufferView): number
  resize(cols: number, rows: number): void
  close(): void
}

export type FetchCompress = boolean | "gzip" | "deflate" | "br" | "zstd" | { encoding: string; level?: number }

export type FetchInit = RequestInit & { compress?: FetchCompress }

export type WebViewModifier = "Shift" | "Control" | "Alt" | "Meta"

export type WebViewBackend =
  | "webkit"
  | "chrome"
  | {
      type: "webkit" | "chrome"
      path?: string
      argv?: string[]
      url?: string | false
      stdout?: "inherit" | "ignore"
      stderr?: "inherit" | "ignore"
    }

export interface WebViewClickOptions {
  button?: "left" | "right" | "middle"
  modifiers?: WebViewModifier[]
  clickCount?: 1 | 2 | 3
  timeout?: number
}

export interface WebViewInstance {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  onNavigated: ((url: string, title: string) => void) | null
  onNavigationFailed: ((error: Error) => void) | null
  navigate(url: string): Promise<void>
  evaluate(script: string): Promise<unknown>
  screenshot(options?: {
    format?: "png" | "jpeg" | "webp"
    quality?: number
    encoding?: "blob" | "buffer" | "base64" | "shmem"
  }): Promise<Blob | Buffer | string | { name: string; size: number }>
  click(x: number, y: number, options?: WebViewClickOptions): Promise<void>
  click(selector: string, options?: WebViewClickOptions): Promise<void>
  type(text: string): Promise<void>
  press(key: string, options?: { modifiers?: WebViewModifier[] }): Promise<void>
  scroll(dx: number, dy: number): Promise<void>
  scrollTo(selector: string, options?: { block?: "start" | "center" | "end" | "nearest"; timeout?: number }): Promise<void>
  resize(width: number, height: number): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(): Promise<void>
  cdp(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
  [Symbol.dispose](): void
  [Symbol.asyncDispose](): void | Promise<void>
}

export interface WebViewConstructor {
  new (options?: {
    width?: number
    height?: number
    url?: string
    headless?: boolean
    backend?: WebViewBackend
    console?: Console | ((type: string, ...args: unknown[]) => void)
    dataStore?: "ephemeral" | { directory: string }
  }): WebViewInstance
  closeAll(): void
}

export interface BunUtils {
  Image: ImageConstructor
  Archive: ArchiveConstructor
  JSONL: {
    parse(input: string | Uint8Array): unknown[]
    parseChunk(input: string | Uint8Array, start?: number, end?: number): JSONLChunk
  }
  JSONC: { parse(input: string): unknown }
  cron: CronFn
  stripANSI(input: string): string
  sliceAnsi(input: string, start: number, end?: number): string
  wrapAnsi(input: string, columns: number): string
  stringWidth(input: string): number
  isStandaloneExecutable: boolean
  gc?(major?: boolean): void
  WebView: WebViewConstructor
  spawn(
    cmd: string[],
    options: {
      cwd?: string
      env?: Record<string, string>
      stdin?: "pipe" | "ignore"
      stdout?: "pipe" | "ignore"
      stderr?: "pipe" | "ignore"
      windowsHide?: boolean
      cgroup?: string
      terminal?: {
        cols?: number
        rows?: number
        data?: (terminal: SpawnTerminal, data: Uint8Array) => void
        exit?: (terminal: SpawnTerminal, exitCode: number, signal: string | null) => void
      }
    },
  ): {
    readonly pid: number
    readonly terminal?: SpawnTerminal
    readonly stdin: unknown
    readonly stdout: ReadableStream<Uint8Array> | null
    readonly stderr: ReadableStream<Uint8Array> | null
    readonly exited: Promise<number>
    readonly exitCode: number | null
    kill(signal?: number | NodeJS.Signals): void
  }
}

export const bunUtils = Bun as unknown as typeof Bun & BunUtils

/** Parse JSONL, skipping corrupt lines the way `split + JSON.parse` used to. */
export function parseJsonl(text: string): unknown[] {
  if (!text.trim()) return []
  const out: unknown[] = []
  let rest = text
  while (rest.length > 0) {
    const chunk = bunUtils.JSONL.parseChunk(rest)
    out.push(...chunk.values)
    if (!chunk.error) break
    const next = rest.indexOf("\n", chunk.read)
    if (next === -1) break
    rest = rest.slice(next + 1)
  }
  return out
}

export function stripAnsi(input: string): string {
  return bunUtils.stripANSI(input)
}

export function onMemoryPressure(handler: () => void) {
  const proc = process as typeof process & {
    on(event: "memoryPressure", listener: () => void): typeof process
  }
  proc.on("memoryPressure", handler)
}

export function fetchCompressed(input: RequestInfo | URL, init?: FetchInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase()
  if (init?.body && (method === "POST" || method === "PUT" || method === "PATCH") && init.compress === undefined) {
    return fetch(input, { ...init, compress: "gzip" } as RequestInit)
  }
  return fetch(input, init as RequestInit)
}

/** WebKit on macOS (nothing to install). Chrome/Edge/Chromium elsewhere — WebKit is macOS-only. */
export function defaultWebViewBackend(): "webkit" | "chrome" {
  const override = process.env.NIKCLI_WEBVIEW_BACKEND?.trim().toLowerCase()
  if (override === "chrome" || override === "webkit") return override
  return process.platform === "darwin" ? "webkit" : "chrome"
}

export function createWebView(options: {
  width?: number
  height?: number
  url?: string
  headless?: boolean
  console?: Console | ((type: string, ...args: unknown[]) => void)
  dataStore?: "ephemeral" | { directory: string }
}): WebViewInstance {
  if (typeof bunUtils.WebView !== "function") {
    throw new Error("Bun.WebView is not available in this Bun build")
  }
  return new bunUtils.WebView({
    headless: true,
    dataStore: "ephemeral",
    ...options,
    backend: defaultWebViewBackend(),
  }) as unknown as WebViewInstance
}
