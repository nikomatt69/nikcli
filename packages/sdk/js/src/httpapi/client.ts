export * from "./generated/types.js"
export { ClientError, type ClientErrorReason } from "./generated/client-error.js"
export type { ClientOptions, RequestOptions } from "./generated/client.js"
export type { CallOptions, Result } from "./compat.js"

import { make } from "./generated/client.js"
import { compat } from "./compat.js"
import type {
  Config,
  MCPStatus,
  LSPStatus,
  ProviderAuthOutput,
  ProviderListOutput,
  ProviderOAuthAuthorization,
  SessionContextBreakdownOutput,
  SessionMessageOutput,
  SessionPromptPromptInput,
  SessionV2EntryList,
  MobileRoutineListOutput,
  MobileGitStatusOutput,
  MobileGitCommitsOutput,
  MobileGitBranchesOutput,
} from "./generated/types.js"

export type NikcliClient = ReturnType<typeof compat>

export type NikcliClientConfig = {
  readonly baseUrl: string
  /** Applied to every request; combined with any per-request signal. */
  readonly signal?: AbortSignal
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: RequestInit["headers"]
  /** Binds the client to an instance directory via `x-nikcli-directory`. */
  readonly directory?: string
  /** Binds the client to a workspace via `x-nikcli-workspace`. */
  readonly workspace?: string
  /** Reject on failure instead of resolving with `{ error }`. Per-call overridable. */
  readonly throwOnError?: boolean
}

export function createNikcliClient(config: NikcliClientConfig): NikcliClient {
  const headers = new Headers(config.headers)
  if (config.directory !== undefined) {
    // Header values are latin-1; percent-encode anything outside it so a
    // non-ASCII project path does not throw on Headers.set.
    const encoded = /[^\x00-\x7F]/.test(config.directory) ? encodeURIComponent(config.directory) : config.directory
    headers.set("x-nikcli-directory", encoded)
  }
  if (config.workspace !== undefined) headers.set("x-nikcli-workspace", config.workspace)

  const base = config.fetch ?? globalThis.fetch
  const signal = config.signal
  const fetch: typeof globalThis.fetch = signal
    ? Object.assign(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const merged = init?.signal ? AbortSignal.any([signal, init.signal]) : signal
          return base(input, { ...init, signal: merged })
        },
        // `preconnect` is an optimisation hint with no observable behaviour;
        // it only has to exist for the value to satisfy `typeof fetch`.
        { preconnect: () => undefined },
      )
    : base

  return compat(make({ baseUrl: config.baseUrl, fetch, headers }), { throwOnError: config.throwOnError })
}

// ─────────────────────── contract-name compatibility ────────────────────────
// The Effect contract renamed a handful of types relative to the Hono-era
// OpenAPI. These aliases keep one name per domain object across the repo; they
// are plain re-exports, not new shapes.

export type LspStatus = LSPStatus
export type McpStatus = MCPStatus
export type ProviderListResponse = ProviderListOutput
export type ProviderAuthResponse = ProviderAuthOutput
export type ProviderAuthAuthorization = ProviderOAuthAuthorization
export type SessionContextResponse = SessionContextBreakdownOutput
export type SessionMessageResponse = SessionMessageOutput
export type MobileRoutine = MobileRoutineListOutput[number]
export type MobileGitStatusResponse = MobileGitStatusOutput
export type MobileGitCommitsResponse = MobileGitCommitsOutput
export type MobileGitBranchesResponse = MobileGitBranchesOutput

/**
 * One entry of the event-sourced v2 session log. The contract still carries the
 * entry union as an open type — see specs/effect/http-api.md, "Contract schema
 * split".
 */
export type SessionEntry = SessionV2EntryList[number]

/** The `parts` union accepted by `session.prompt`. */
export type PromptPartInput = SessionPromptPromptInput["parts"][number]
export type TextPartInput = Extract<PromptPartInput, { type: "text" }>
export type FilePartInput = Extract<PromptPartInput, { type: "file" }>
export type AgentPartInput = Extract<PromptPartInput, { type: "agent" }>

/** Provider credentials as stored by `auth.set`. */
export type Auth = Parameters<NikcliClient["auth"]["set"]>[0]["payload"]

/** The full `nikcli.json` document. */
export type NikcliConfig = Config
