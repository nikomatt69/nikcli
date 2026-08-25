/**
 * Tool test context factory.
 *
 * High-risk tools (`bash`, `write`, `edit`, `apply_patch`, `monitor`,
 * `task`, `batch`, `code_mode`) all take a `Tool.Context` whose shape
 * is hand-rolled in the tests. The helper produces a usable context
 * with deterministic IDs, stub `ask`/`progress`/`metadata` callbacks,
 * and recorders so tests can assert on permission/metadata traffic.
 *
 * Usage:
 *
 *   import { makeToolContext } from "../helpers/tool-context"
 *   import { WriteTool } from "@/tool/write"
 *
 *   const { ctx, asked } = makeToolContext({ sessionID: "test" })
 *   const def = await WriteTool.init()
 *   const result = await def.executeAsync({ filePath: "/tmp/x", content: "hi" }, ctx)
 *   expect(result.output).toContain("Wrote file successfully")
 *   expect(asked.length).toBeGreaterThan(0)
 */
import { Identifier } from "@nikcli-ai/util/id"
import { Instance } from "@/project/instance"
import { InstanceState, type InstanceContext } from "@/effect"
import type { Tool } from "@/tool/tool"

export type AskRecord = {
  permission: string
  patterns: string[]
  always: string[]
  metadata?: unknown
}

export type MakeToolContextOptions = {
  /** sessionID for the test. Defaults to a unique ascending id. */
  sessionID?: string
  /** messageID for the test. Defaults to a unique ascending id. */
  messageID?: string
  /** callID for the test. Defaults to a unique ascending id. */
  callID?: string
  /** Agent name. Defaults to "build". */
  agent?: string
  /** AbortSignal. Defaults to a fresh AbortController signal. */
  abort?: AbortSignal
  /** Pin the instance. By default it is read from the enclosing scope on access. */
  instance?: InstanceContext
  /** Override the ask recorder. By default, asks accumulate into `asked`. */
  ask?: Tool.Context["ask"]
  /** Override progress handler. */
  progress?: Tool.Context["progress"]
  /** Override metadata handler. */
  metadata?: Tool.Context["metadata"]
  /**
   * When true, the default `ask` rejects with an Error so tests can
   * exercise the permission-denied path. Mutually exclusive with a
   * custom `ask` override.
   */
  denyAsk?: boolean
}

export type ToolContextBundle = {
  ctx: Tool.Context
  asked: AskRecord[]
  recordedMetadata: Array<{ title?: string; metadata?: unknown }>
  recordedProgress: unknown[]
  sessionID: string
  messageID: string
  callID: string
}

/**
 * Build a `Tool.Context` plus recorders for ask/metadata/progress.
 * Sync — nothing here needs I/O.
 */
export function makeToolContext(options: MakeToolContextOptions = {}): ToolContextBundle {
  const sessionID = options.sessionID ?? Identifier.ascending("session")
  const messageID = options.messageID ?? Identifier.ascending("message")
  const callID = options.callID ?? Identifier.ascending("part")
  const asked: AskRecord[] = []
  const recordedMetadata: Array<{ title?: string; metadata?: unknown }> = []
  const recordedProgress: unknown[] = []

  const ask: Tool.Context["ask"] =
    options.ask ??
    (async (input) => {
      asked.push({
        permission: input.permission,
        patterns: [...input.patterns],
        always: [...input.always],
        metadata: input.metadata,
      })
      if (options.denyAsk) {
        throw new Error(`Permission denied: ${input.permission}`)
      }
    })

  const metadata: Tool.Context["metadata"] =
    options.metadata ??
    ((input) => {
      recordedMetadata.push(input)
    })

  const progress: Tool.Context["progress"] =
    options.progress ??
    (async (input) => {
      recordedProgress.push(input)
    })

  const ctx: Tool.Context = {
    // Resolved on access rather than at construction. Tests build the context
    // outside `withProjectDirectory` and execute the tool inside it — the
    // order the ambient read used to make invisible — so reading eagerly here
    // would throw for every one of them. The production contract is a plain
    // field; this getter reproduces, for tests only, the timing they were
    // written against.
    get instance() {
      return options.instance ?? InstanceState.ambient()
    },
    sessionID,
    messageID,
    callID,
    agent: options.agent ?? "build",
    abort: options.abort ?? new AbortController().signal,
    ask,
    metadata,
    progress,
  }

  return {
    ctx,
    asked,
    recordedMetadata,
    recordedProgress,
    sessionID,
    messageID,
    callID,
  }
}

/**
 * Run `fn` inside an `Instance` ALS scope for `directory`.
 * Tool execute paths read `Instance.directory` / `worktree`, so every
 * behavioural tool test must wrap execute (and FileTime.read) in this.
 */
export async function withProjectDirectory<T>(directory: string, fn: () => Promise<T>): Promise<T> {
  return Instance.provide({ directory, fn })
}
