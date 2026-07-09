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
  }
  readonly requests: {
    readonly latestOnlyLspRefresh: boolean
  }
}

type Experimental = NonNullable<Config.Info["experimental"]> & {
  tui?: {
    cacheEviction?: boolean
    messageVirtualization?: boolean
  }
  requests?: {
    latestOnlyLspRefresh?: boolean
  }
}

/** Accept full Config.Info or a partial with experimental (SDK client config). */
export function features(cfg: { experimental?: Config.Info["experimental"] } | undefined | null): Features {
  const e = cfg?.experimental as Experimental | undefined
  return {
    nativeLlm: e?.nativeLlm === true,
    tui: {
      cacheEviction: e?.tui?.cacheEviction === true,
      messageVirtualization: e?.tui?.messageVirtualization === true,
    },
    requests: {
      latestOnlyLspRefresh: e?.requests?.latestOnlyLspRefresh === true,
    },
  }
}

export * as Features from "./features"
