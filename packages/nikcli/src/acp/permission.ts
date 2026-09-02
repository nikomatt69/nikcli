import { existsSync, readFileSync } from "node:fs"
import { applyPatch } from "diff"
import type { AgentSideConnection, PermissionOption, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { Event, NikcliClient } from "@nikcli-ai/sdk/httpapi"
import { Log } from "@nikcli-ai/util/log"
import { toLocations, toToolKind } from "./tool"

const log = Log.create({ service: "acp-permission" })

/**
 * Three-option permission menu surfaced to the client for every
 * permission request. The IDs are stable strings the service layer uses to
 * translate the user's choice into the SDK's `once` / `always` / `reject`
 * reply vocabulary.
 */
const permissionOptions: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

type PermissionEvent = Extract<Event, { type: "permission.asked" }>
type Reply = "once" | "always" | "reject"

/**
 * Subset of the agent-side connection we actually need for permission
 * prompts. Marked `Partial` because some clients (notably in tests) may
 * not advertise `requestPermission` or `writeTextFile` capabilities.
 */
type Connection = Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>

/**
 * Serializes concurrent permission requests per session.
 *
 * The nikcli backend emits `permission.asked` events as tools ask for
 * authorization. The client may receive multiple events faster than the
 * user can answer. We chain each session's requests through a single
 * promise so the client UI sees them in order and we never lose a reply.
 */
export class Handler {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly input: {
      sdk: NikcliClient
      connection: Connection
    },
  ) {}

  /**
   * Enqueue a permission event for processing. Returns immediately; the
   * returned promise resolves when this event (and everything queued
   * before it for the same session) has been answered.
   */
  handle(event: PermissionEvent): Promise<void> {
    const sessionID = event.properties.sessionID
    const previous = this.queues.get(sessionID) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(event))
      .catch((error) => {
        log.error("failed to process permission event", { error, sessionID })
      })
      .finally(() => {
        if (this.queues.get(sessionID) === next) {
          this.queues.delete(sessionID)
        }
      })
    this.queues.set(sessionID, next)
    return next
  }

  private async process(event: PermissionEvent): Promise<void> {
    const permission = event.properties
    const sessionID = permission.sessionID

    // Without `requestPermission` we cannot ask the user — auto-reject.
    if (!this.input.connection.requestPermission) {
      await this.reply(permission.id, "reject")
      return
    }

    let response: RequestPermissionResponse | undefined
    try {
      response = await this.input.connection.requestPermission({
        sessionId: sessionID,
        toolCall: {
          toolCallId: permission.tool?.callID ?? permission.id,
          status: "pending",
          title: permission.permission,
          rawInput: permission.metadata,
          kind: toToolKind(permission.permission),
          locations: toLocations(permission.permission, permission.metadata),
        },
        options: permissionOptions,
      })
    } catch (error) {
      // Treat a thrown request as a rejection so the nikcli backend does
      // not hang waiting for a reply it will never receive.
      log.error("permission request failed", {
        error,
        sessionID,
        permissionID: permission.id,
      })
      await this.reply(permission.id, "reject")
      return
    }

    if (!response) return

    const reply = selectedReply(response)
    if (reply !== "once" && reply !== "always") {
      await this.reply(permission.id, "reject")
      return
    }

    // For edit permissions we pre-apply the diff so the file on disk
    // matches the version the user just approved. The writeTextFile
    // capability is optional; if absent we silently skip the write and
    // the model will still apply the edit on its next tool call.
    if (permission.permission === "edit") {
      await this.writeProposedEdit(permission.metadata).catch((error) => {
        log.error("failed to apply proposed edit", {
          error,
          permissionID: permission.id,
        })
      })
    }

    await this.reply(permission.id, reply)
  }

  private async reply(requestID: string, reply: Reply): Promise<void> {
    try {
      await this.input.sdk.permission.reply({
        requestID,
        reply,
      })
    } catch (error) {
      log.error("failed to send permission reply", { error, requestID, reply })
    }
  }

  /**
   * Apply the unified diff bundled with an `edit` permission. The backend
   * already validated the diff against the file, so a failure here means
   * the file changed underneath us — we swallow the error to avoid
   * surfacing a duplicate failure to the user.
   */
  private async writeProposedEdit(metadata: unknown): Promise<void> {
    const filepath = stringValue((metadata as Record<string, unknown> | undefined)?.filepath)
    const diff = stringValue((metadata as Record<string, unknown> | undefined)?.diff)
    if (!filepath || !diff || !this.input.connection.writeTextFile) return

    let original: string
    try {
      original = existsSync(filepath) ? readFileSync(filepath, "utf8") : ""
    } catch {
      return
    }

    const next = applyPatch(original, diff)
    if (next === false) return

    try {
      // Best-effort write — the connection may also reject it for files
      // outside the client's writeTextFile roots.
      await this.input.connection.writeTextFile({
        sessionId: "",
        path: filepath,
        content: next,
      })
    } catch {
      // ignore
    }
  }
}

/**
 * Translate the client's permission outcome into the SDK reply vocabulary
 * used by the nikcli permission API. Anything we cannot recognize becomes
 * a `reject` so we never grant a tool accidentally.
 */
function selectedReply(result: RequestPermissionResponse): Reply {
  if (result.outcome.outcome !== "selected") return "reject"
  if (result.outcome.optionId === "once" || result.outcome.optionId === "always") return result.outcome.optionId
  return "reject"
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export * as ACPPermission from "./permission"
