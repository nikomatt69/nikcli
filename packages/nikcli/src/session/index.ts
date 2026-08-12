import { Slug } from "@nikcli-ai/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type LanguageModelV2Usage } from "@ai-sdk/provider"
import type { ProviderMetadata } from "ai"
import { iife } from "@/util/iife"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Identifier } from "../id/id"
import { Installation } from "../installation"

import { Storage } from "../storage/storage"
import { runStorage, storageRead, storageRemove, storageWrite } from "@/storage/effect"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { SessionPrimitives } from "./primitives"
import { fn } from "@/util/fn"
import { Snapshot } from "@/snapshot"

import type { Provider } from "@/provider/provider"
import { PermissionNext } from "@/permission/next"
import { Global } from "@/global"
import { WorkspaceContext } from "../workspace/workspace-context"
import { WorkspaceDB } from "../workspace/db"
import {
  InstanceState,
  locallyInstance,
  runPromiseWithLayer,
  withCurrentInstance,
  type InstanceContext,
} from "@/effect"
import { Context, Effect, Layer, Schema } from "effect"
import { zodObject, zodObjectMode, type DeepMutable } from "@/util/effect-zod"
import { Analytics } from "../analytics/analytics"
import { SessionRepo } from "./repo"
import { SessionSync } from "./projectors"
import { SyncEvent } from "@/sync/sync-event"
import { MessageRepo } from "./message-repo"

function configGet(ctx?: InstanceContext) {
  const effect = Effect.gen(function* () {
    const config = yield* Config.Service
    return yield* config.get()
  })
  return runPromiseWithLayer(Config.defaultLayer, ctx ? locallyInstance(ctx, effect) : withCurrentInstance(effect))
}

function publishBus(ctx: InstanceContext, def: any, properties: any) {
  return runPromiseWithLayer(
    Bus.defaultLayer,
    locallyInstance(
      ctx,
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        yield* bus.publish(def, properties)
      }),
    ),
  )
}

export namespace Session {
  const log = Log.create({ service: "session" })
  const analyticsLog = Log.create({ service: "session-analytics" })

  const strip = zodObjectMode("strip")

  export const WorktreeInfoSchema = Schema.Struct({
    name: Schema.String,
    branch: Schema.String,
    directory: Schema.String,
    /**
     * The original (non-worktree) repo directory this worktree was branched
     * from. Only set on the top-level `Session.Info.worktree` -- GitHub
     * sessions already carry the equivalent `github.repositoryDirectory`
     * as a sibling field.
     */
    repositoryDirectory: Schema.optional(Schema.String),
    cleanedAt: Schema.optional(Schema.Number),
  }).annotate({ ...strip, identifier: "SessionWorktree" })
  const WorktreeInfo = zodObject(WorktreeInfoSchema)

  export const GithubInfoSchema = Schema.Struct({
    owner: Schema.String,
    repo: Schema.String,
    fullName: Schema.String,
    baseBranch: Schema.String,
    headBranch: Schema.String,
    repositoryDirectory: Schema.optional(Schema.String),
    cloneUrl: Schema.optional(Schema.String),
    htmlUrl: Schema.optional(Schema.String),
    private: Schema.optional(Schema.Boolean),
    worktree: WorktreeInfoSchema,
    pullRequest: Schema.optional(
      Schema.Struct({
        number: Schema.Number,
        url: Schema.String,
        title: Schema.String,
      }).annotate(strip),
    ),
    lastCommitSha: Schema.optional(Schema.String),
    publishedAt: Schema.optional(Schema.Number),
    publishError: Schema.optional(Schema.String),
  }).annotate({ ...strip, identifier: "SessionGithub" })
  const GithubInfo = zodObject(GithubInfoSchema)

  export const MobileInfoSchema = Schema.Struct({
    platforms: Schema.Array(Schema.Literals(["ios", "android", "expo", "flutter", "react-native"])),
    primaryPlatform: Schema.String,
    method: Schema.String,
    detectedAt: Schema.Number,
    buildStatus: Schema.optional(Schema.Literals(["unknown", "building", "succeeded", "failed"])),
    lastBuildAt: Schema.optional(Schema.Number),
    artifacts: Schema.optional(
      Schema.Array(
        Schema.Struct({
          platform: Schema.String,
          path: Schema.String,
          size: Schema.optional(Schema.Number),
          createdAt: Schema.optional(Schema.Number),
        }).annotate(strip),
      ),
    ),
  }).annotate({ ...strip, identifier: "SessionMobile" })
  const MobileInfo = zodObject(MobileInfoSchema)

  export type MobileInfo = DeepMutable<Schema.Schema.Type<typeof MobileInfoSchema>>

  const createDefaultTitle = SessionPrimitives.createDefaultTitle
  export const isDefaultTitle = SessionPrimitives.isDefaultTitle

  export const InfoSchema = Schema.Struct({
    id: Identifier.schemaEffect("session"),
    slug: Schema.String,
    projectID: Schema.String,
    directory: Schema.String,
    parentID: Schema.optional(Identifier.schemaEffect("session")),
    workspaceID: Schema.optional(Schema.String),
    summary: Schema.optional(
      Schema.Struct({
        additions: Schema.Number,
        deletions: Schema.Number,
        files: Schema.Number,
        diffs: Schema.optional(Schema.Array(Snapshot.FileDiffSchema)),
      }).annotate(strip),
    ),
    share: Schema.optional(
      Schema.Struct({
        url: Schema.String,
      }).annotate(strip),
    ),
    github: Schema.optional(GithubInfoSchema),
    /**
     * Isolated worktree for plain (non-GitHub) sessions -- see
     * createSessionWorktreeContext in server/mobile/helpers.ts.
     * GitHub-linked sessions keep their worktree nested under `github`
     * instead, since it doubles as PR/publish metadata there.
     */
    worktree: Schema.optional(WorktreeInfoSchema),
    mobile: Schema.optional(MobileInfoSchema),
    title: Schema.String,
    activeCommand: Schema.optional(Schema.String),
    version: Schema.String,
    time: Schema.Struct({
      created: Schema.Number,
      updated: Schema.Number,
      compacting: Schema.optional(Schema.Number),
      archived: Schema.optional(Schema.Number),
    }).annotate(strip),
    permission: Schema.optional(PermissionNext.RulesetSchema),
    skills: Schema.optional(Schema.Array(Schema.String)),
    /**
     * Paths of custom instruction files (AGENTS.md, CLAUDE.md, etc.) that
     * the user has explicitly disabled for this session. The server
     * filters these out of the system prompt at build time so the model
     * never sees them — the only way to actually shrink that part of the
     * context.
     */
    disabledInstructions: Schema.optional(Schema.Array(Schema.String)),
    /**
     * Tool IDs the user has disabled for this session. Both the schema
     * (so the model never sees them) and the permission rule are
     * suppressed. Map value is unused but kept as a record for forward
     * compatibility with "true/false" partial disables.
     */
    disabledTools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
    revert: Schema.optional(
      Schema.Struct({
        messageID: Schema.String,
        partID: Schema.optional(Schema.String),
        snapshot: Schema.optional(Schema.String),
        diff: Schema.optional(Schema.String),
      }).annotate(strip),
    ),
  }).annotate({ ...strip, identifier: "Session" })
  export const Info = zodObject(InfoSchema)
  export type Info = DeepMutable<Schema.Schema.Type<typeof InfoSchema>>

  export const ShareInfoSchema = Schema.Struct({
    id: Schema.optional(Schema.String),
    mode: Schema.optional(Schema.Literals(["remote", "local"])),
    secret: Schema.optional(Schema.String),
    url: Schema.String,
  }).annotate({ ...strip, identifier: "SessionShare" })
  export const ShareInfo = zodObject(ShareInfoSchema)
  export type ShareInfo = DeepMutable<Schema.Schema.Type<typeof ShareInfoSchema>>

  export const ID = SessionPrimitives.ID

  export const CreateInput = z
    .object({
      parentID: ID.optional(),
      title: z.string().optional(),
      permission: Info.shape.permission,
      skills: z.array(z.string()).optional(),
      disabledInstructions: z.array(z.string()).optional(),
      disabledTools: z.record(z.string(), z.boolean()).optional(),
      github: GithubInfo.optional(),
      worktree: WorktreeInfo.optional(),
      workspaceID: Info.shape.workspaceID,
    })
    .optional()
  export type CreateInput = z.infer<typeof CreateInput>

  export const ForkInput = z.object({
    sessionID: ID,
    messageID: Identifier.schema("message").optional(),
  })
  export type ForkInput = z.infer<typeof ForkInput>

  export const MessagesInput = z.object({
    sessionID: ID,
    limit: z.number().optional(),
  })
  export type MessagesInput = z.infer<typeof MessagesInput>

  export const RemoveMessageInput = z.object({
    sessionID: ID,
    messageID: Identifier.schema("message"),
  })
  export type RemoveMessageInput = z.infer<typeof RemoveMessageInput>

  export const RemovePartInput = z.object({
    sessionID: ID,
    messageID: Identifier.schema("message"),
    partID: Identifier.schema("part"),
  })
  export type RemovePartInput = z.infer<typeof RemovePartInput>

  export const UpdatePartInput = z.union([
    MessageV2.Part,
    z.object({
      part: MessageV2.TextPart,
      delta: z.string(),
    }),
    z.object({
      part: MessageV2.ReasoningPart,
      delta: z.string(),
    }),
  ])

  const UsageInput = z.object({
    model: z.custom<Provider.Model>(),
    usage: z.custom<LanguageModelV2Usage>(),
    metadata: z.custom<ProviderMetadata>().optional(),
  })
  type UsageInput = z.infer<typeof UsageInput>

  export const Event = {
    Created: BusEvent.schema(
      "session.created",
      Schema.Struct({
        info: InfoSchema,
      }),
    ),
    Updated: BusEvent.schema(
      SessionPrimitives.EventName.updated,
      Schema.Struct({
        info: InfoSchema,
      }),
    ),
    Deleted: BusEvent.schema(
      SessionPrimitives.EventName.deleted,
      Schema.Struct({
        info: InfoSchema,
      }),
    ),
    Diff: BusEvent.schema(
      SessionPrimitives.EventName.diff,
      Schema.Struct({
        sessionID: Schema.String,
        diff: Schema.Array(Snapshot.FileDiffSchema),
      }),
    ),
    Error: BusEvent.schema(
      SessionPrimitives.EventName.error,
      Schema.Struct({
        sessionID: Schema.optional(Schema.String),
        error: Schema.optional(MessageV2.AssistantErrorSchema),
      }),
    ),
  }

  export type CreateNextInput = {
    id?: string
    title?: string
    parentID?: string
    directory: string
    workspaceID?: string
    permission?: PermissionNext.Ruleset
    skills?: string[]
    disabledInstructions?: string[]
    disabledTools?: Record<string, boolean>
    github?: z.infer<typeof GithubInfo>
    worktree?: z.infer<typeof WorktreeInfo>
    mobile?: MobileInfo
  }

  async function getImpl(ctx: InstanceContext, id: string) {
    const read = SessionRepo.get(id)
    if (!read) throw new Storage.NotFoundError({ message: `Session not found: ${id}` })
    return read as Info
  }

  function planImpl(ctx: InstanceContext, input: { slug: string; time: { created: number } }) {
    const base = ctx.project.vcs ? path.join(ctx.worktree, ".nikcli", "plans") : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  async function updateImpl(
    ctx: InstanceContext,
    id: string,
    editor: (session: Info) => void,
    options?: { touch?: boolean },
  ) {
    // The event carries the whole session, and its projector performs the
    // write: the edit is applied here only to compute what the event says.
    const existing = SessionRepo.get(id)
    if (!existing) throw new Storage.NotFoundError({ message: `Session not found: ${id}` })
    const result = structuredClone(existing)
    editor(result)
    if (options?.touch !== false) {
      result.time.updated = Date.now()
    }
    SessionSync.install()
    SyncEvent.run(SessionSync.Updated, { sessionID: id, info: result }, { projectID: ctx.project.id })
    return result
  }

  async function shareImpl(ctx: InstanceContext, id: string) {
    const cfg = await configGet(ctx)
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { ShareNext } = await import("@/share/share-next")
    const share = await runPromiseWithLayer(
      ShareNext.defaultLayer,
      Effect.gen(function* () {
        const shareNext = yield* ShareNext.Service
        return yield* shareNext.create(id)
      }),
    )
    await updateImpl(
      ctx,
      id,
      (draft) => {
        draft.share = {
          url: share.url,
        }
      },
      { touch: false },
    )
    return share
  }

  async function unshareImpl(ctx: InstanceContext, id: string) {
    const { ShareNext } = await import("@/share/share-next")
    await runPromiseWithLayer(
      ShareNext.defaultLayer,
      Effect.gen(function* () {
        const shareNext = yield* ShareNext.Service
        yield* shareNext.remove(id)
      }),
    )
    await updateImpl(
      ctx,
      id,
      (draft) => {
        draft.share = undefined
      },
      { touch: false },
    )
  }

  async function forkImpl(ctx: InstanceContext, input: ForkInput) {
    const original = await getImpl(ctx, input.sessionID)
    const session = await createNextImpl(ctx, {
      parentID: original.id,
      directory: original.directory,
      workspaceID: original.workspaceID,
      skills: original.skills,
    })
    const msgs = await messagesImpl(ctx, { sessionID: input.sessionID })
    const idMap = new Map<string, string>()

    for (const msg of msgs) {
      if (input.messageID && msg.info.id >= input.messageID) break
      const newID = Identifier.ascending("message")
      idMap.set(msg.info.id, newID)

      const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
      const cloned = await updateMessageImpl(ctx, {
        ...msg.info,
        sessionID: session.id,
        id: newID,
        ...(parentID && { parentID }),
      })

      for (const part of msg.parts) {
        await updatePartImpl(ctx, {
          ...part,
          id: Identifier.ascending("part"),
          messageID: cloned.id,
          sessionID: session.id,
        })
      }
    }
    return session
  }

  async function createNextImpl(ctx: InstanceContext, input: CreateNextInput) {
    const inheritedSkills =
      !input.skills && input.parentID ? (await getImpl(ctx, input.parentID).catch(() => undefined))?.skills : undefined
    const result: Info = {
      id: Identifier.descending("session", input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: ctx.project.id,
      directory: input.directory,
      parentID: input.parentID,
      workspaceID: input.workspaceID ?? WorkspaceContext.workspaceID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      skills: input.skills ?? inheritedSkills ?? [],
      disabledInstructions: input.disabledInstructions,
      disabledTools: input.disabledTools,
      github: input.github,
      worktree: input.worktree,
      mobile: input.mobile,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    SessionSync.install()
    SyncEvent.run(SessionSync.Created, { sessionID: result.id, info: result }, { projectID: ctx.project.id })
    if (result.workspaceID) WorkspaceDB.touch(result.workspaceID, result.time.created)
    const cfg = await configGet(ctx)
    if (!result.parentID && (Flag.NIKCLI_AUTO_SHARE || cfg.share === "auto"))
      shareImpl(ctx, result.id)
        .then((share) => {
          return updateImpl(ctx, result.id, (draft) => {
            draft.share = share
          })
        })
        .catch((error) => {
          // Auto-share is best-effort during session creation, but keep a trace.
          log.warn("failed to auto-share session", {
            sessionID: result.id,
            error,
          })
        })
    SyncEvent.run(SessionSync.Updated, { sessionID: result.id, info: result }, { projectID: ctx.project.id })

    // Record session creation for analytics
    Analytics.recordSession({
      sessionID: result.id,
      projectID: ctx.project.id,
      directory: result.directory,
      timestamp: result.time.created,
    }).catch((err) => {
      analyticsLog.error("Failed to record session for analytics", {
        sessionID: result.id,
        error: err,
      })
    })

    return result
  }

  async function getAnyProjectImpl(ctx: InstanceContext, id: string) {
    // SessionRepo.get searches across all projects
    const session = SessionRepo.get(id)
    if (session) return session as Info

    throw new Storage.NotFoundError({ message: `Session not found: ${id}` })
  }

  async function diffImpl(sessionID: string) {
    const diffs = await storageRead<Snapshot.FileDiff[]>(["session_diff", sessionID])
    return diffs ?? []
  }

  async function messagesImpl(ctx: InstanceContext, input: MessagesInput) {
    await getImpl(ctx, input.sessionID)
    if (input.limit) {
      const page = await MessageV2.page({
        sessionID: input.sessionID,
        limit: input.limit,
      })
      return page.items.toReversed()
    }

    const result = [] as MessageV2.WithParts[]
    for await (const msg of MessageV2.stream(input.sessionID)) {
      result.push(msg)
    }
    result.reverse()
    return result
  }

  async function* listImpl(ctx: InstanceContext) {
    const activeWorkspaceID = WorkspaceContext.workspaceID
    for (const session of SessionRepo.list(ctx.project.id)) {
      if (activeWorkspaceID && session.workspaceID !== activeWorkspaceID) continue
      yield session
    }
  }

  async function childrenImpl(ctx: InstanceContext, parentID: string) {
    return SessionRepo.getChildren(parentID)
  }

  async function removeImpl(ctx: InstanceContext, sessionID: string) {
    try {
      const session = await getImpl(ctx, sessionID)

      // Record session end analytics before removing
      const sessionMessages = MessageRepo.listMessages(sessionID)
      let totalInput = 0,
        totalOutput = 0,
        totalReasoning = 0,
        totalCacheRead = 0,
        totalCacheWrite = 0
      let totalCost = 0,
        msgCount = 0,
        toolCalls = 0
      let lastProviderID = "unknown",
        lastModelID = "unknown"

      for (const msg of sessionMessages) {
        try {
          if (msg.role === "assistant" && msg.tokens) {
            totalInput += msg.tokens.input || 0
            totalOutput += msg.tokens.output || 0
            totalReasoning += msg.tokens.reasoning || 0
            totalCacheRead += msg.tokens.cache?.read || 0
            totalCacheWrite += msg.tokens.cache?.write || 0
            totalCost += msg.cost || 0
            msgCount++
            if (msg.providerID) lastProviderID = msg.providerID
            if (msg.modelID) lastModelID = msg.modelID
          }
        } catch {}
      }

      // Count tool parts
      for (const msg of sessionMessages) {
        try {
          const parts = MessageRepo.listParts(msg.id)
          for (const part of parts) {
            try {
              if (part.type === "tool") toolCalls++
            } catch {}
          }
        } catch {}
      }

      Analytics.recordSessionEnd({
        sessionID,
        projectID: ctx.project.id,
        directory: session.directory,
        title: session.title,
        providerID: lastProviderID,
        modelID: lastModelID,
        messages: msgCount,
        tokens: {
          input: totalInput,
          output: totalOutput,
          reasoning: totalReasoning,
          cacheRead: totalCacheRead,
          cacheWrite: totalCacheWrite,
        },
        cost: totalCost,
        toolCalls,
        duration: session.time.updated - session.time.created,
        created: session.time.created,
        completed: session.time.updated,
      }).catch((err) => {
        analyticsLog.error("Failed to record session end for analytics", {
          sessionID,
          error: err,
        })
      })

      for (const child of await childrenImpl(ctx, sessionID)) {
        await removeImpl(ctx, child.id)
      }
      await unshareImpl(ctx, sessionID).catch((err) => {
        log.warn("Failed to unshare session during deletion", {
          sessionID,
          error: err,
        })
      })
      // Remove all messages and their parts via SQL
      for (const msg of sessionMessages) {
        MessageRepo.removeMessage(sessionID, msg.id)
      }
      await storageRemove(["session_diff", sessionID]).catch((err) => {
        log.error("Storage operation failed", { error: err })
      })
      await storageRemove(["goal", sessionID]).catch((err) => {
        log.error("Storage operation failed", { error: err })
      })
      SessionSync.install()
      SyncEvent.run(SessionSync.Deleted, { sessionID, info: session }, { projectID: ctx.project.id })
    } catch (e) {
      log.error(e)
    }
  }

  /**
   * `MessageRepo.removeMessage` deletes the message and its parts, but leaves
   * the v2 entries projected from them — so this goes through the same sync
   * event as `removeMessage`, which deletes both inside one transaction.
   */
  async function removeMessageWithPartsImpl(ctx: InstanceContext, sessionID: string, messageID: string) {
    await removeMessageImpl(ctx, { sessionID, messageID })
  }

  async function updateMessageImpl(ctx: InstanceContext, msg: MessageV2.Info) {
    SessionSync.install()
    SyncEvent.run(SessionSync.MessageUpdated, { sessionID: msg.sessionID, info: msg }, { projectID: ctx.project.id })

    // Record assistant message analytics
    if (msg.role === "assistant" && msg.tokens && msg.time.completed) {
      Analytics.recordMessage({
        sessionID: msg.sessionID,
        projectID: ctx.project.id,
        directory: ctx.project.worktree,
        providerID: msg.providerID,
        modelID: msg.modelID,
        tokens: {
          input: msg.tokens.input || 0,
          output: msg.tokens.output || 0,
          reasoning: msg.tokens.reasoning || 0,
          cache: {
            read: msg.tokens.cache?.read || 0,
            write: msg.tokens.cache?.write || 0,
          },
        },
        cost: msg.cost || 0,
        timestamp: msg.time.completed,
      }).catch((err) => {
        log.error("Storage operation failed", { error: err })
      })
    }

    return msg
  }

  async function removeMessageImpl(ctx: InstanceContext, input: RemoveMessageInput) {
    SessionSync.install()
    SyncEvent.run(
      SessionSync.MessageRemoved,
      { sessionID: input.sessionID, messageID: input.messageID },
      { projectID: ctx.project.id },
    )
    return input.messageID
  }

  async function removePartImpl(ctx: InstanceContext, input: RemovePartInput) {
    await MessageV2.get({
      sessionID: input.sessionID,
      messageID: input.messageID,
    })
    SessionSync.install()
    SyncEvent.run(
      SessionSync.PartRemoved,
      { sessionID: input.sessionID, messageID: input.messageID, partID: input.partID },
      { projectID: ctx.project.id },
    )
    return input.partID
  }

  async function updatePartImpl(ctx: InstanceContext, input: z.input<typeof UpdatePartInput>) {
    const part = "delta" in input ? input.part : input
    const delta = "delta" in input ? input.delta : undefined
    SessionSync.install()
    SyncEvent.run(SessionSync.PartUpdated, { sessionID: part.sessionID, part, delta }, { projectID: ctx.project.id })

    // Record tool usage analytics
    if (part.type === "tool" && part.tool) {
      const isSuccess =
        part.state && typeof part.state === "object" && "status" in part.state
          ? part.state.status === "completed"
          : false
      const isError =
        part.state && typeof part.state === "object" && "status" in part.state ? part.state.status === "error" : false
      if (isSuccess || isError) {
        Analytics.recordToolUse({
          toolName: part.tool,
          sessionID: part.sessionID,
          success: isSuccess,
          timestamp: Date.now(),
        }).catch((err) => {
          log.error("Storage operation failed", { error: err })
        })
      }
    }

    return part
  }

  export const getUsage = fn(UsageInput, (input) => {
    const safe = (value: number) => {
      if (!Number.isFinite(value)) return 0
      return value
    }
    const inputTokens = safe(input.usage.inputTokens ?? 0)
    const outputTokens = safe(input.usage.outputTokens ?? 0)
    const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

    const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
    const cacheWriteInputTokens = safe(
      // `nikcli` is published by the native @nikcli-ai/llm adapter, which decodes
      // cache writes uniformly across protocols (including OpenAI, whose writes
      // @ai-sdk/openai drops entirely). It wins because it is already normalized.
      (input.metadata?.["nikcli"]?.["cacheWriteInputTokens"] ??
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0) as number,
    )

    const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
    const bedrockIncludesCacheWrite = !!input.metadata?.["bedrock"]
    const adjustedInputTokens = safe(
      excludesCachedTokens
        ? bedrockIncludesCacheWrite
          ? inputTokens - cacheWriteInputTokens
          : inputTokens
        : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
    )

    const total = iife(() => {
      if (
        input.model.api.npm === "@ai-sdk/anthropic" ||
        input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
        input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
      ) {
        return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
      }
      return input.usage.totalTokens
    })

    const tokens = {
      total,
      input: adjustedInputTokens,
      output: outputTokens,
      reasoning: reasoningTokens,
      cache: {
        write: cacheWriteInputTokens,
        read: cacheReadInputTokens,
      },
    }

    // OpenRouter reports the actual billed cost via usage accounting
    // (providerMetadata.openrouter.usage.cost). Prefer it when present — it is
    // authoritative and covers meta-models like `openrouter/fusion` that have
    // no fixed catalog price (catalog computation would yield 0 for them).
    const reportedCost = (input.metadata?.["openrouter"] as any)?.["usage"]?.["cost"]
    if (
      input.model.api.npm === "@openrouter/ai-sdk-provider" &&
      typeof reportedCost === "number" &&
      Number.isFinite(reportedCost) &&
      reportedCost > 0
    ) {
      return { cost: reportedCost, tokens }
    }

    const costInfo =
      input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
        ? input.model.cost.experimentalOver200K
        : input.model.cost
    return {
      cost: safe(
        new Decimal(0)
          .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
          .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
          .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
          .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
          // models.dev does not expose separate reasoning pricing yet; use output pricing for reasoning tokens.
          .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
          .toNumber(),
      ),
      tokens,
    }
  })

  export class BusyError extends Schema.TaggedErrorClass<BusyError>()("SessionBusyError", {
    sessionID: Schema.String,
    message: Schema.String,
  }) {
    static create(sessionID: string) {
      return new BusyError({
        sessionID,
        message: `Session ${sessionID} is busy`,
      })
    }
  }

  /**
   * Union of all errors that any `Session.Service` method can fail with. Use
   * this in the Effect error channel of downstream consumers so they can
   * `Effect.catchTag` against the specific error class.
   *
   * `Storage.NotFoundError` is included because the session storage helpers
   * throw a `NotFoundError` when a session ID does not exist.
   */
  export type Error = BusyError | Storage.NotFoundError | Storage.IOError

  export interface Interface {
    create(input?: CreateInput): Effect.Effect<Info, Error>
    fork(input: ForkInput): Effect.Effect<Info, Error>
    touch(sessionID: string): Effect.Effect<void, Error>
    createNext(input: CreateNextInput): Effect.Effect<Info, Error>
    plan(input: { slug: string; time: { created: number } }): Effect.Effect<string>
    get(id: string): Effect.Effect<Info, Error>
    getAnyProject(id: string): Effect.Effect<Info, Error>
    getShare(id: string): Effect.Effect<ShareInfo, Error>
    share(id: string): Effect.Effect<ShareInfo, Error>
    unshare(id: string): Effect.Effect<void, Error>
    update(id: string, editor: (session: Info) => void, options?: { touch?: boolean }): Effect.Effect<Info, Error>
    diff(sessionID: string): Effect.Effect<Snapshot.FileDiff[], Error>
    messages(input: MessagesInput): Effect.Effect<MessageV2.WithParts[], Error>
    list(): Effect.Effect<AsyncIterable<Info>>
    children(parentID: string): Effect.Effect<Info[], Error>
    remove(sessionID: string): Effect.Effect<void, Error>
    removeMessageWithParts(sessionID: string, messageID: string): Effect.Effect<void, Error>
    updateMessage(msg: MessageV2.Info): Effect.Effect<MessageV2.Info, Error>
    removeMessage(input: RemoveMessageInput): Effect.Effect<string, Error>
    removePart(input: RemovePartInput): Effect.Effect<string, Error>
    updatePart(input: z.input<typeof UpdatePartInput>): Effect.Effect<MessageV2.Part, Error>
    getUsage(input: UsageInput): Effect.Effect<ReturnType<typeof getUsage>, never>
  }

  export class Service extends Context.Service<Service, Interface>()("Session.Service") {}

  /**
   * Preserve the typed session error thrown by an impl. The session helpers
   * primarily surface `Storage.NotFoundError` (when a session ID does not
   * exist) and `Storage.IOError` (on disk failures); any other rejection
   * becomes an `IOError` so the service's Effect error channel stays typed
   * at the `Session.Error` union.
   */
  function asSessionError(e: unknown): Error {
    if (e instanceof BusyError) return e
    if (e instanceof Storage.NotFoundError) return e
    if (e instanceof Storage.IOError) return e
    if (e instanceof Error) {
      return new Storage.IOError({ message: e.message, cause: e })
    }
    return new Storage.IOError({ message: String(e) })
  }

  export const layer = Layer.succeed(
    Service,
    Service.of({
      create: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () =>
                createNextImpl(ctx, {
                  parentID: input?.parentID,
                  directory: ctx.directory,
                  title: input?.title,
                  permission: input?.permission,
                  skills: input?.skills,
                  disabledInstructions: input?.disabledInstructions,
                  disabledTools: input?.disabledTools,
                  github: input?.github,
                  worktree: input?.worktree,
                  workspaceID: input?.workspaceID,
                }),
              catch: asSessionError,
            }),
          ),
        ),
      fork: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => forkImpl(ctx, input),
              catch: asSessionError,
            }),
          ),
        ),
      touch: (sessionID) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () =>
                updateImpl(ctx, sessionID, (draft) => {
                  draft.time.updated = Date.now()
                }),
              catch: asSessionError,
            }).pipe(Effect.asVoid),
          ),
        ),
      createNext: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => createNextImpl(ctx, input),
              catch: asSessionError,
            }),
          ),
        ),
      plan: (input) => InstanceState.context.pipe(Effect.map((ctx) => planImpl(ctx, input))),
      get: (id) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => getImpl(ctx, id),
              catch: asSessionError,
            }),
          ),
        ),
      getAnyProject: (id) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => getAnyProjectImpl(ctx, id),
              catch: asSessionError,
            }),
          ),
        ),
      getShare: (id) =>
        Effect.tryPromise({
          try: () => storageRead<ShareInfo>(["session_share", id]),
          catch: asSessionError,
        }),
      share: (id) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => shareImpl(ctx, id),
              catch: asSessionError,
            }),
          ),
        ),
      unshare: (id) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => unshareImpl(ctx, id),
              catch: asSessionError,
            }),
          ),
        ),
      update: (id, editor, options) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => updateImpl(ctx, id, editor, options),
              catch: asSessionError,
            }),
          ),
        ),
      diff: (sessionID) =>
        Effect.tryPromise({
          try: () => diffImpl(sessionID),
          catch: asSessionError,
        }),
      messages: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => messagesImpl(ctx, input),
              catch: asSessionError,
            }),
          ),
        ),
      list: () => InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.sync(() => listImpl(ctx)))),
      children: (parentID) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => childrenImpl(ctx, parentID),
              catch: asSessionError,
            }),
          ),
        ),
      remove: (sessionID) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => removeImpl(ctx, sessionID),
              catch: asSessionError,
            }),
          ),
        ),
      removeMessageWithParts: (sessionID, messageID) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => removeMessageWithPartsImpl(ctx, sessionID, messageID),
              catch: asSessionError,
            }),
          ),
        ),
      updateMessage: (msg) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => updateMessageImpl(ctx, msg),
              catch: asSessionError,
            }),
          ),
        ),
      removeMessage: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => removeMessageImpl(ctx, input),
              catch: asSessionError,
            }),
          ),
        ),
      removePart: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => removePartImpl(ctx, input),
              catch: asSessionError,
            }),
          ),
        ),
      updatePart: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => updatePartImpl(ctx, input),
              catch: asSessionError,
            }),
          ),
        ),
      getUsage: (input) => Effect.sync(() => getUsage(input)),
    }),
  )

  export const defaultLayer = layer
}
