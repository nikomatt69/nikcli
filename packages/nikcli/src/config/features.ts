/**
 * Typed experimental feature flags.
 *
 * Central place for opencode-parity / native-LLM gates so callers don't
 * cast `config.experimental` ad hoc. All flags default **off** until soak.
 * (A 2026-07-08 flip-all attempt was rolled back 2026-07-09: with the flags
 * on, the TUI stopped rendering streamed assistant parts. Re-flip one flag
 * at a time after verifying the session stream end-to-end.)
 */
import type { Config } from "./config"

export type Features = {
  readonly nativeLlm: boolean
  readonly tui: {
    readonly cacheEviction: boolean
    readonly messageVirtualization: boolean
    readonly explorationGrouping: boolean
    readonly entryRenderer: boolean
  }
  readonly requests: {
    readonly latestOnlyLspRefresh: boolean
  }
  readonly events: {
    readonly schemaEncoding: boolean
  }
}

type Experimental = NonNullable<Config.Info["experimental"]> & {
  tui?: {
    cacheEviction?: boolean
    messageVirtualization?: boolean
    explorationGrouping?: boolean
    entryRenderer?: boolean
  }
  requests?: {
    latestOnlyLspRefresh?: boolean
  }
  events?: {
    schemaEncoding?: boolean
  }
}

/** Accept full Config.Info or a partial with experimental (SDK client config). */
export function features(cfg: { experimental?: Config.Info["experimental"] } | undefined | null): Features {
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
      // Draw the session from v2 entries instead of v1 messages and parts.
      // Both build the same `Turn[]` (routes/session/view.ts) and the two are
      // proved equivalent by test, so this only changes which store feeds it.
      // Off until the entry store is seeded on every path a session can be
      // opened from.
      entryRenderer: e?.tui?.entryRenderer === true,
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
