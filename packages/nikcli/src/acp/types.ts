/**
 * Public ACP configuration type used by `cmd/acp.ts` to spin up the
 * agent. Kept in its own module so the protocol boundary does not need
 * to depend on the internals of the new modular `acp` package.
 */
import type { NikcliClient } from "@nikcli-ai/sdk/v2"

export interface ACPConfig {
  /** Client used to talk to the local nikcli server. */
  sdk: NikcliClient
  /**
   * Optional override for the default model. When omitted, the service
   * derives it from the working directory's configuration.
   */
  defaultModel?: {
    providerID: string
    modelID: string
  }
  /**
   * Optional override for the working directory. When omitted, the
   * protocol's `cwd` from each request is used.
   */
  cwd?: string
}

/**
 * Re-export of the protocol's current default auth method id. Mirrors
 * opencode's `AuthMethodID` constant so a client can identify our auth
 * method in a `terminal-auth` flow without re-importing the SDK.
 */
export const AuthMethodID = "nikcli-login"
