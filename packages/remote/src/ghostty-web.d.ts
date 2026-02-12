declare module "ghostty-web" {
  export class Ghostty {
    static load(wasmPath?: string): Promise<Ghostty>
    createTerminal(cols?: number, rows?: number, config?: GhosttyTerminalConfig): GhosttyTerminal
  }

  export interface GhosttyTerminalConfig {
    scrollbackLimit?: number
    fgColor?: number
    bgColor?: number
    cursorColor?: number
    palette?: number[]
  }

  export class GhosttyTerminal {
    write(data: string | Uint8Array): void
    resize(cols: number, rows: number): void
    get cols(): number
    get rows(): number
    getDimensions(): { cols: number; rows: number }
    getCursor(): { x: number; y: number; visible: boolean }
    getScrollbackLength(): number
    isAlternateScreen(): boolean
    isRowWrapped(row: number): boolean
    getLine(y: number): GhosttyCell[] | null
    getScrollbackLine(offset: number): GhosttyCell[] | null
    isDirty(): boolean
    isRowDirty(y: number): boolean
    clearDirty(): void
    free(): void
  }

  export interface GhosttyCell {
    codepoint: number
    fg_r: number
    fg_g: number
    fg_b: number
    bg_r: number
    bg_g: number
    bg_b: number
    flags: number
    width: number
    hyperlink_id: number
  }

  export class CanvasRenderer {
    constructor(canvas: HTMLCanvasElement, options?: RendererOptions)
    resize(cols: number, rows: number): void
    render(terminal: GhosttyTerminal, forceAll?: boolean): void
    setTheme(theme: ITheme): void
    setFontSize(size: number): void
    setFontFamily(family: string): void
    setCursorStyle(style: "block" | "underline" | "bar"): void
    setCursorBlink(enabled: boolean): void
    getMetrics(): FontMetrics
    getCanvas(): HTMLCanvasElement
  }

  export interface RendererOptions {
    fontSize?: number
    fontFamily?: string
    cursorStyle?: "block" | "underline" | "bar"
    cursorBlink?: boolean
    theme?: ITheme
  }

  export interface ITheme {
    background: string
    foreground: string
    cursor: string
    selectionBackground?: string
  }

  export interface FontMetrics {
    width: number
    height: number
    baseline: number
  }
}
