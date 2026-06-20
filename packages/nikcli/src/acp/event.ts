import type { AgentSideConnection, ContentBlock } from "@agentclientprotocol/sdk"
import type { Event, NikcliClient, Part, SessionMessageResponse, ToolPart } from "@nikcli-ai/sdk/v2"
import { Log } from "@/util/log"
import {
  completedToolUpdate,
  duplicateRunningToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  shellOutputSnapshot,
} from "./tool"

/**
 * Subset of the agent-side connection the event subscription needs.
 * Marked `Partial` so tests can build a connection without every method.
 */
type Connection = Pick<AgentSideConnection, "sessionUpdate">

type GlobalEventEnvelope = {
  payload?: Event
}

type GlobalEventStream = {
  stream: AsyncIterable<GlobalEventEnvelope>
}

const log = Log.create({ service: "acp-event" })

/**
 * Subscribes to the nikcli global event stream and projects the
 * interesting event types (`permission.asked`, `message.part.updated`)
 * into ACP `session/update` notifications on the agent-side connection.
 *
 * The subscription:
 * - throttles shell output updates by comparing snapshots so we don't spam
 *   the client with duplicate frames;
 * - keeps a per-call "started" set so we emit the `pending` `tool_call`
 *   only once per `callID`;
 * - owns a single long-lived `AbortController` so `stop()` tears down the
 *   SSE loop deterministically when the connection closes.
 */
export class Subscription {
  private readonly abort = new AbortController()
  private readonly shellSnapshots = new Map<string, string>()
  private readonly toolStarts = new Set<string>()
  private started = false
  private runPromise: Promise<void> | undefined

  constructor(
    private readonly input: {
      sdk: NikcliClient
      connection: Connection
      // optional session store used for tool-call running session cwd lookup
      sessionCwd?: (sessionId: string) => string | undefined
    },
  ) {}

  /**
   * Start the event subscription. Safe to call multiple times; subsequent
   * calls are no-ops.
   */
  start(): void {
    if (this.started) return
    this.started = true
    this.runPromise = this.run().catch((error) => {
      if (this.abort.signal.aborted) return
      log.error("event subscription crashed", { error })
    })
  }

  /**
   * Stop the subscription, aborting the in-flight SSE loop and waiting
   * for the underlying promise to settle.
   */
  async stop(): Promise<void> {
    this.abort.abort()
    if (this.runPromise) {
      try {
        await this.runPromise
      } catch {
        // abort is expected to reject; swallow.
      }
    }
  }

  /**
   * Manually route an `Event` into the subscription. Useful when the
   * service layer has an event in hand (e.g. during `session/load`'s
   * history replay) and wants to push it through the same projection.
   */
  async handle(event: Event): Promise<void> {
    try {
      await this.handleEvent(event)
    } catch (error) {
      log.error("failed to handle event", { error, type: event.type })
    }
  }

  /**
   * Replay every part of a historical message through the same
   * `session/update` projection used by the live stream. Used after
   * `session/load` to reconstruct the conversation in the client's UI.
   */
  async replayMessage(message: SessionMessageResponse): Promise<void> {
    if (message.info.role !== "assistant" && message.info.role !== "user") return

    for (const part of message.parts) {
      if (part.type === "tool") {
        await this.handleToolPart(message.info.sessionID, part, this.cwdFor(message.info.sessionID))
        continue
      }
      await this.replayContentPart(message.info.sessionID, message.info.role, part)
    }
  }

  // ───────────────────────────── private ──────────────────────────────

  private async run(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const stream = (await this.input.sdk.global.event({
          signal: this.abort.signal,
        })) as GlobalEventStream

        for await (const envelope of stream.stream) {
          if (this.abort.signal.aborted) return
          const event = envelope?.payload
          if (!event) continue
          await this.handle(event).catch((error) => {
            log.error("failed to handle event", { error, type: event.type })
          })
        }
      } catch (error) {
        if (this.abort.signal.aborted) return
        log.error("event subscription stream error", { error })
      }

      if (!this.abort.signal.aborted) {
        // Backoff before reconnecting so a flapping backend does not
        // saturate the connection with retries.
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
      }
    }
  }

  private async handleEvent(event: Event): Promise<void> {
    switch (event.type) {
      case "permission.asked":
        // Routed by the dedicated `Handler` outside this subscription so
        // permission prompts and tool events can be ordered independently.
        return

      case "message.part.updated": {
        const part = event.properties.part
        const sessionId = part.sessionID
        await this.handlePartUpdated(sessionId, part, this.cwdFor(sessionId))
        return
      }

      default:
        // Other event types are not surfaced to ACP clients.
        return
    }
  }

  private async handlePartUpdated(sessionId: string, part: Part, cwd: string | undefined): Promise<void> {
    if (part.type === "tool") {
      await this.handleToolPart(sessionId, part, cwd)
      return
    }

    if (part.type === "text") {
      const delta = (part as Part & { type: "text" }).text
      if (delta && (part as { ignored?: boolean }).ignored !== true) {
        await this.sendChunk(sessionId, "agent_message_chunk", {
          type: "text",
          text: delta,
        }).catch((error) => {
          log.error("failed to send text chunk to ACP", { error })
        })
      }
      return
    }

    if (part.type === "reasoning") {
      const delta = (part as Part & { type: "reasoning" }).text
      if (delta) {
        await this.sendChunk(sessionId, "agent_thought_chunk", {
          type: "text",
          text: delta,
        }).catch((error) => {
          log.error("failed to send reasoning chunk to ACP", { error })
        })
      }
      return
    }

    if (part.type === "file") {
      // File attachments are not streamed; they're either replayed via
      // `replayMessage` or skipped if the model emitted them mid-turn.
      return
    }
  }

  private async replayContentPart(sessionId: string, role: "user" | "assistant", part: Part): Promise<void> {
    const update: "agent_message_chunk" | "user_message_chunk" | "agent_thought_chunk" =
      part.type === "reasoning" ? "agent_thought_chunk" : role === "user" ? "user_message_chunk" : "agent_message_chunk"

    if (part.type === "text") {
      const text = (part as Part & { type: "text" }).text
      if (!text) return
      const audience = (part as { synthetic?: boolean; ignored?: boolean }).synthetic
        ? (["assistant"] as const)
        : (part as { synthetic?: boolean; ignored?: boolean }).ignored
          ? (["user"] as const)
          : undefined
      const content: ContentBlock = audience
        ? { type: "text", text, annotations: { audience: [...audience] } }
        : { type: "text", text }
      await this.sendChunk(sessionId, update, content).catch(() => {})
      return
    }

    if (part.type === "reasoning") {
      const text = (part as Part & { type: "reasoning" }).text
      if (!text) return
      await this.sendChunk(sessionId, update, { type: "text", text }).catch(() => {})
      return
    }

    if (part.type === "file") {
      const file = part as Part & { type: "file" }
      if (!file.url) return
      // Replay file attachments as resource_link so the client can
      // recover the original filename and URI. Data URLs are skipped —
      // their content is recoverable from disk via the resource_link.
      if (file.url.startsWith("file://")) {
        await this.sendChunk(sessionId, update, {
          type: "resource_link",
          uri: file.url,
          name: file.filename ?? "file",
          mimeType: file.mime,
        }).catch(() => {})
      }
    }
  }

  private async handleToolPart(sessionId: string, part: ToolPart, cwd: string | undefined): Promise<void> {
    await this.emitPending(sessionId, part, cwd)

    switch (part.state.status) {
      case "pending":
        // The pending frame was already emitted above; nothing else to do.
        this.shellSnapshots.delete(part.callID)
        return

      case "running":
        await this.emitRunning(sessionId, part, cwd)
        return

      case "completed":
        this.clearTool(part.callID)
        await this.input.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...completedToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: {
                  status: "completed",
                  input: part.state.input,
                  output: part.state.output,
                  title: part.state.title,
                  metadata: part.state.metadata,
                  attachments: part.state.attachments,
                },
                cwd,
              }),
            },
          })
          .catch((error) => log.error("failed to send tool completed to ACP", { error }))
        return

      case "error":
        this.clearTool(part.callID)
        await this.input.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...errorToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: {
                  status: "error",
                  input: part.state.input,
                  error: part.state.error,
                  metadata: part.state.metadata,
                },
                cwd,
              }),
            },
          })
          .catch((error) => log.error("failed to send tool error to ACP", { error }))
        return
    }
  }

  private async emitPending(sessionId: string, part: ToolPart, cwd: string | undefined): Promise<void> {
    if (this.toolStarts.has(part.callID)) return
    this.toolStarts.add(part.callID)
    const title = part.state.status === "running" || part.state.status === "completed" ? part.state.title : undefined
    await this.input.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          ...pendingToolCall({
            toolCallId: part.callID,
            toolName: part.tool,
            state: { input: part.state.input, title },
            cwd,
          }),
        },
      })
      .catch((error) => log.error("failed to send tool pending to ACP", { error }))
  }

  private async emitRunning(sessionId: string, part: ToolPart, cwd: string | undefined): Promise<void> {
    if (part.state.status !== "running") return

    const output = shellOutputSnapshot(part.state)
    if (output !== undefined) {
      const previous = this.shellSnapshots.get(part.callID)
      if (previous === output) {
        // Same snapshot as last frame — emit a duplicate in_progress
        // frame so the client knows we're still alive without flooding
        // the output buffer.
        await this.input.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...duplicateRunningToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: {
                  status: "running",
                  input: part.state.input,
                  title: part.state.title,
                },
                cwd,
              }),
            },
          })
          .catch((error) =>
            log.error("failed to send duplicate shell snapshot to ACP", {
              error,
            }),
          )
        return
      }
      this.shellSnapshots.set(part.callID, output)
    }

    await this.input.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: part.callID,
            toolName: part.tool,
            state: {
              status: "running",
              input: part.state.input,
              title: part.state.title,
            },
            output,
            cwd,
          }),
        },
      })
      .catch((error) => log.error("failed to send tool running to ACP", { error }))
  }

  private clearTool(toolCallId: string): void {
    this.toolStarts.delete(toolCallId)
    this.shellSnapshots.delete(toolCallId)
  }

  private cwdFor(sessionId: string): string | undefined {
    return this.input.sessionCwd?.(sessionId)
  }

  private async sendChunk(
    sessionId: string,
    sessionUpdate: "agent_message_chunk" | "user_message_chunk" | "agent_thought_chunk",
    content: ContentBlock,
  ): Promise<void> {
    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate,
        content,
      } as Parameters<Connection["sessionUpdate"]>[0]["update"],
    })
  }
}

export * as ACPEvent from "./event"
