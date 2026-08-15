/**
 * Typed experimental feature flags.
 *
 * Central place for opencode-parity / native-LLM gates so callers don't
 * cast `config.experimental` ad hoc. Flags default **off** until soak.
 * (A 2026-07-08 flip-all attempt was rolled back 2026-07-09: with the flags
 * on, the TUI stopped rendering streamed assistant parts. Re-flip one flag
 * at a time after verifying the session stream end-to-end.)
 */

export type Features = {
  readonly nativeLlm: boolean
  readonly tui: {
    readonly cacheEviction: boolean
    readonly messageVirtualization: boolean
    readonly explorationGrouping: boolean
  }
  readonly requests: {
    readonly latestOnlyLspRefresh: boolean
  }
  readonly events: {
    readonly schemaEncoding: boolean
  }
}

/**
 * Only the flags this module reads. Deliberately structural rather than derived from
 * `Config.Info`: every field below is checked with `=== true`, so naming the full config type
 * bought no safety while tying a pure predicate to the server's config module.
 */
type Experimental = {
  nativeLlm?: boolean
  tui?: {
    cacheEviction?: boolean
    messageVirtualization?: boolean
    explorationGrouping?: boolean
  }
  requests?: {
    latestOnlyLspRefresh?: boolean
  }
  events?: {
    schemaEncoding?: boolean
  }
}

/** Accepts a full `Config.Info`, the SDK's client config, or anything else carrying `experimental`. */
export function features(cfg: { experimental?: unknown } | undefined | null): Features {
  const e = cfg?.experimental as Experimental | undefined
  return {
    nativeLlm: e?.nativeLlm === true,
    tui: {
      cacheEviction: e?.tui?.cacheEviction === true,
      // Stays opt-in until the windowing heuristic is finished: it assumes a flat 6-row height for
      // every message (see MESSAGE_HEIGHT_ESTIMATE in routes/session/index.tsx — heights are never
      // measured), polls the scroll position on a 50ms timer, and disables itself while streaming,
      // which is exactly when a long transcript costs the most. Turning it on by default would
      // trade a real rendering cost for wrong scroll windows.
      messageVirtualization: e?.tui?.messageVirtualization === true,
      explorationGrouping: e?.tui?.explorationGrouping === true,
    },
    requests: {
      latestOnlyLspRefresh: e?.requests?.latestOnlyLspRefresh === true,
    },
    events: {
      schemaEncoding: e?.events?.schemaEncoding === true,
    },
  }
}

export * as Features from "./features"
