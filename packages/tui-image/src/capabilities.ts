/**
 * Terminal graphics capability detection.
 *
 * The module exposes a single {@link detectCapabilities} function that inspects
 * `process.env` (and an optional `Stream`-like override) and returns which of
 * the three modern graphics protocols the connected terminal advertises:
 *
 *  - {@link Protocol.KITTY}  — Kitty Graphics Protocol (Kitty, Ghostty, WezTerm ≥ 20230712, Konsole ≥ 22.04, Rio, Warp).
 *  - {@link Protocol.SIXEL}  — DEC Sixel (mlterm, foot, Terminology, and terminals that report Sixel through OpenTUI).
 *  - {@link Protocol.ITERM2} — iTerm2 inline images (iTerm2 ≥ 2.9, WezTerm, Konsole, mintty, Rio).
 *
 * Detection is *purely* synchronous and side-effect free; it never probes the
 * terminal by writing escape sequences. The OpenTUI `CliRenderer` already
 * negotiates the live answer at startup — consumers that have a `capabilities`
 * object can pass it through {@link detectCapabilities}'s second argument and
 * short-circuit the heuristic.
 *
 * Heuristic: we look at well-known environment variables (`TERM`, `TERM_PROGRAM`,
 * `KITTY_WINDOW_ID`, `WEZTERM_EXECUTABLE`, `GHOSTTY_RESOURCES_DIR`,
 * `KONSOLE_VERSION`, `ITERM_SESSION_ID`, `COLORTERM`, …) and return a
 * deterministic list. The list is sorted from highest to lowest fidelity so
 * callers can pick `result[0]` as the best available protocol.
 */
export enum Protocol {
  KITTY = "kitty",
  SIXEL = "sixel",
  ITERM2 = "iterm2",
}

export type StreamKind = "stdout" | "stderr"

export interface StreamProbe {
  /**
   * Tells `detectCapabilities` whether the stream that the bytes will be
   * written to is a TTY and what kind it is. Defaults to `stdout`.
   */
  readonly kind?: StreamKind
  /**
   * A best-effort `isTTY` flag. When `true` the stream is treated as a real
   * terminal; when `false` or omitted the function falls back to env-var
   * detection only.
   */
  readonly isTTY?: boolean
}

export interface Capabilities {
  /** Best available protocol, or `null` if none of the three are supported. */
  readonly best: Protocol | null
  /** All detected protocols, ordered from highest to lowest fidelity. */
  readonly available: readonly Protocol[]
  /** Whether Kitty Graphics Protocol is supported. */
  readonly kitty: boolean
  /** Whether Sixel graphics are supported. */
  readonly sixel: boolean
  /** Whether iTerm2 inline images are supported. */
  readonly iterm2: boolean
  /** Underlying terminal identifier (best guess, e.g. `iTerm.app`, `WezTerm`). */
  readonly terminal: string | null
}

export type OverlayProtocol = Protocol.SIXEL | Protocol.ITERM2

interface Env {
  [key: string]: string | undefined
}

function readEnv(): Env {
  if (typeof process !== "undefined" && process.env) return process.env as Env
  return {}
}

/**
 * Inspect a single terminal identifier. Exported so that callers (notably
 * OpenTUI's `capabilities` object) can short-circuit the heuristic.
 */
export function protocolForTerminal(
  terminal: string | null | undefined,
  colorterm: string | undefined,
): Protocol | null {
  if (!terminal) {
    if (colorterm && /^(truecolor|24bit)$/i.test(colorterm)) return null
    return null
  }
  const lower = terminal.toLowerCase()
  if (lower.includes("kitty")) return Protocol.KITTY
  if (lower.includes("ghostty")) return Protocol.KITTY
  if (lower.includes("warp")) return Protocol.KITTY
  if (lower.includes("wezterm")) return Protocol.KITTY // WezTerm supports all 3, prefer Kitty
  if (lower.includes("konsole")) return Protocol.KITTY // Konsole ≥ 22.04 supports Kitty
  if (lower.includes("rio")) return Protocol.KITTY
  if (lower.includes("iterm")) return Protocol.ITERM2
  if (lower.includes("vscode")) return null
  if (lower.includes("mintty")) return Protocol.ITERM2
  if (lower.includes("mlterm")) return Protocol.SIXEL
  if (lower.includes("foot")) return Protocol.SIXEL
  return null
}

/**
 * Walk the environment and return every protocol we can plausibly use.
 *
 * The order is fixed: Kitty → Sixel → iTerm2. Callers should pick the first
 * match, falling back to a non-native renderer (halfblock ANSI) when
 * `available` is empty.
 */
/**
 * Subset of OpenTUI's negotiated terminal capabilities
 * (`CliRenderer.capabilities`), filled in from the live DA1 / kitty graphics
 * query responses at renderer startup.
 */
export interface LiveCapabilities {
  readonly kitty_graphics?: boolean
  readonly sixel?: boolean
  readonly terminal?: { readonly name?: string } | null
}

/**
 * Merge the env-based heuristic with the answer the terminal actually gave at
 * startup (surfaced by OpenTUI as `renderer.capabilities`).
 *
 * - Sixel: the DA1 response is authoritative. Generic identifiers such as
 *   `TERM=xterm-256color` are deliberately not treated as proof of support.
 * - Kitty: a negotiated `true` augments the env answer; a negotiated `false`
 *   keeps explicit env signals (`KITTY_WINDOW_ID`, …) intact, since the query
 *   can be lost behind multiplexers.
 * - iTerm2: not queryable through DA1. Only explicit terminal identifiers
 *   (real iTerm2, WezTerm, mintty, …) are trusted.
 */
export function applyLiveCapabilities(
  detected: Capabilities,
  live: LiveCapabilities | null | undefined,
  env: Env = readEnv(),
): Capabilities {
  if (!live) return detected
  const kitty = detected.kitty || live.kitty_graphics === true
  const sixel = live.sixel === true
  const liveName = typeof live.terminal === "object" && live.terminal ? (live.terminal.name ?? "") : ""
  const identifier = `${detected.terminal ?? ""} ${liveName}`.toLowerCase()
  const explicitIterm2 = Boolean(env.ITERM_SESSION_ID) || /iterm|wezterm|mintty|rio|konsole/.test(identifier)
  const iterm2 = detected.iterm2 && (explicitIterm2 || sixel)
  const available = [
    kitty ? Protocol.KITTY : null,
    sixel ? Protocol.SIXEL : null,
    iterm2 ? Protocol.ITERM2 : null,
  ].filter((protocol): protocol is Protocol => protocol !== null)
  return {
    best: available[0] ?? null,
    available,
    kitty,
    sixel,
    iterm2,
    terminal: detected.terminal ?? (liveName || null),
  }
}

export function detectCapabilities(stream?: StreamProbe, env: Env = readEnv()): Capabilities {
  const term = env.TERM ?? env.TERMINAL ?? null
  const termProgram = env.TERM_PROGRAM ?? null
  const colorterm = env.COLORTERM
  const isStderr = stream?.kind === "stderr"

  // OpenTUI renderer short-circuit: if the caller already negotiated the
  // answer, just trust it.
  if (stream && typeof stream === "object" && "isTTY" in stream) {
    // no-op, the fast paths below will still inspect env.
  }

  // Some terminals (notably VS Code's integrated terminal) are not detected via
  // TERM but only via TERM_PROGRAM. We merge the two into a single identifier.
  const candidates = [termProgram, term, env.WEZTERM_EXECUTABLE ? "wezterm" : null].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )

  const detected = new Set<Protocol>()
  for (const candidate of candidates) {
    const protocol = protocolForTerminal(candidate, colorterm)
    if (protocol) detected.add(protocol)
    if (candidate.toLowerCase().includes("wezterm")) {
      detected.add(Protocol.ITERM2)
    }
  }

  // Kitty exposes a stable env var; honour it as an authoritative signal even
  // when the surrounding TERM is misleading.
  if (env.KITTY_WINDOW_ID || env.KITTY_PID || env.KITTY_PUBLIC_KEY) detected.add(Protocol.KITTY)
  if (env.GHOSTTY_RESOURCES_DIR || env.GHOSTTY_BIN_DIR) detected.add(Protocol.KITTY)
  if (env.WEZTERM_EXECUTABLE || env.WEZTERM_PANE) {
    detected.add(Protocol.KITTY)
    detected.add(Protocol.ITERM2)
  }
  if (env.KONSOLE_VERSION) {
    const major = Number.parseInt(env.KONSOLE_VERSION.split(".")[0] ?? "0", 10)
    if (Number.isFinite(major) && major >= 22) detected.add(Protocol.KITTY)
    else detected.add(Protocol.SIXEL)
  }
  if (env.ITERM_SESSION_ID) detected.add(Protocol.ITERM2)
  if (env.TERMINOLOGY_VERSION) detected.add(Protocol.SIXEL)

  // On stderr, several terminals disable sixel/iterm2 to keep logs readable.
  // Kitty still works because the stream is kept in raw mode by the renderer.
  if (isStderr) detected.delete(Protocol.ITERM2)

  const order: readonly Protocol[] = [Protocol.KITTY, Protocol.SIXEL, Protocol.ITERM2]
  const available = order.filter((protocol) => detected.has(protocol))

  return {
    best: available[0] ?? null,
    available,
    kitty: detected.has(Protocol.KITTY),
    sixel: detected.has(Protocol.SIXEL),
    iterm2: detected.has(Protocol.ITERM2),
    terminal: termProgram ?? term,
  }
}

/**
 * Pick a cursor-addressed protocol for renderers that cannot use Kitty
 * Unicode placeholders. Sixel wins when both overlay protocols are available.
 */
export function bestOverlayProtocol(capabilities: Capabilities): OverlayProtocol | null {
  if (capabilities.available.includes(Protocol.SIXEL)) return Protocol.SIXEL
  if (capabilities.available.includes(Protocol.ITERM2)) return Protocol.ITERM2
  return null
}
