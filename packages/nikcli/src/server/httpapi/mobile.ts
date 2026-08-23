import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Schema } from "effect"
import { Project } from "@/project/project"
import { Pty } from "@/pty"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { Workspace } from "@/workspace"
import { Worktree } from "@/worktree"
import { Config } from "@/config/config"
import * as Domain from "./domain"
import {
  MobileCommand,
  MobileGithubDeviceAuthPollResult,
  MobileGithubDeviceAuthStart,
  MobileGithubImportRequest,
  MobileGithubPublishInput,
  MobileGithubPublishResult,
  MobileGithubSessionCreateInput,
  MobileGithubSessionCreateResult,
  MobileGithubBranch,
  MobileGithubImport,
  MobileLoopGenerateInput,
  MobileLoopRuntime,
  MobileLoopRun,
  MobileLoopTemplate,
  MobileLoopWriteInput,
  MobileMemorySearchHit,
  MobileMissionFeatureMutateInput,
  MobileMissionGenerateInput,
  MobileMissionUpdateInput,
  MobileMissionWriteInput,
  MobilePromptHistoryEntry,
  MobilePromptStashEntry,
  MobileRoutine,
  MobileRoutineCreateInput,
  MobileRoutineRunInput,
  MobileRoutineTriggerInput,
  MobileRoutineUpdateInput,
  MobileSessionCommandInput,
  MobileSessionCreateInput,
  MobileSessionDetail,
  MobileSessionSummary,
  MobileWorktreeCreateInput,
  MobileWorktreeRemoveInput,
  MobileWorktreeResetInput,
} from "@/server/mobile/helpers"
import {
  TeleportInput as MobileTeleportInput,
  TeleportOutInput as MobileTeleportOutInput,
} from "@/server/mobile/teleport"
import { MobileAuth } from "@/mobile/auth"
import { fromZod } from "@/util/zod-effect"
import { MissionDefinitionSchema, MissionExecSchema } from "@/mission/schema"
import { SessionPending } from "@/session/pending"
import { Todo } from "@/session/todo"

/**
 * Effect schema for the whole `/mobile/*` surface.
 *
 * Mobile-specific wrapper shapes are typed faithfully after
 * `mobile/helpers.ts`. Domain objects reuse the Effect Schemas their services
 * already own (`Session.InfoSchema`, `Project.InfoSchema`, `Pty.InfoSchema`,
 * …) or the shared definitions in `./domain`, so each one has a single
 * definition across the contract. The few shapes still typed as open records
 * are the ones whose only definition is a zod schema (the `nikcli.json`
 * config document, message parts).
 *
 * `OpenApi.Identifier` pins each operationId to the value the Hono OpenAPI
 * emits, so the SDK generated from either source has the same class tree.
 * The global `directory`/`workspace` query parameters that Hono's middleware
 * adds to every operation are injected spec-wide by `generate.ts`.
 */
export namespace MobileHttpApi {
  const Success = Schema.Struct({
    success: Schema.Literal(true),
  }).annotate({ identifier: "MobileSuccess" })

  /** `POST /session/:id/message` answers 202, not 200 — preserved for parity. */
  const Accepted = Schema.Struct({
    accepted: Schema.Literal(true),
  }).annotate({ identifier: "MobileAccepted", httpApiStatus: 202 })

  /**
   * Declared error contracts for the routes the dispatcher used to answer
   * with a bare `{ error }` body. `name` is a literal so the response encoder
   * can discriminate union members (400 vs 401 vs 404) by value instead of
   * falling back to declaration order — the same trick `session.ts` uses.
   * The `name` field is additive; clients read `error` exactly as before.
   */
  const BadRequest = Schema.Struct({
    name: Schema.Literal("BadRequest"),
    error: Schema.String,
  }).annotate({ identifier: "MobileBadRequest", httpApiStatus: 400 })
  const Unauthorized = Schema.Struct({
    name: Schema.Literal("Unauthorized"),
    error: Schema.String,
  }).annotate({ identifier: "MobileUnauthorized", httpApiStatus: 401 })
  const NotFound = Schema.Struct({
    name: Schema.Literal("NotFoundError"),
    error: Schema.String,
  }).annotate({ identifier: "MobileNotFound", httpApiStatus: 404 })

  const SessionIDPath = Schema.Struct({ sessionID: Schema.String })
  const IDPath = Schema.Struct({ id: Schema.String })

  // Domain objects reuse the Effect Schemas the services already own, so the
  // generated clients get real types and there is a single definition per
  // domain object. Every `/mobile/*` endpoint that answers JSON is an encoded
  // `.handle` (see `mobile-handlers.ts`); SSE, teleport chunk upload and the
  // pty upgrade stay raw.
  const SessionInfo = Session.InfoSchema
  const WorktreeInfo = Worktree.InfoSchema
  const ProjectInfo = Project.InfoSchema
  const PtyInfo = Pty.InfoSchema
  const LoopDefinition = Domain.LoopDefinition
  /**
   * The full `nikcli.json` document. Derived from the zod schema via `fromZod`
   * once `Config.Info` is a single source of truth — no hand-written copy to
   * drift from the schema disk reads.
   */
  const ConfigInfo = fromZod(Config.Info).annotate({ identifier: "MobileConfigInfo" })

  /**
   * Derived from the zod schema that actually stores the token, not hand-copied.
   *
   * The hand-written version had drifted: it omitted `lastUsedAt`, which is the one field a
   * client needs to tell whether a phone has ever connected with the token it was handed.
   */
  const PublicToken = (fromZod(MobileAuth.PublicToken) as unknown as Schema.Struct<Schema.Struct.Fields>).annotate({
    identifier: "MobileAuthTokenPublic",
  })

  // Typed wrappers for the mobile contract — they pin the same shapes the
  // dispatcher parses with at runtime so the SDK gets a real type instead of
  // `Schema.Unknown` → `any`.
  const MobileSessionSummaryEffect = fromZod(MobileSessionSummary).annotate({
    identifier: "MobileSessionSummary",
  })
  const MobileSessionDetailEffect = fromZod(MobileSessionDetail).annotate({
    identifier: "MobileSessionDetail",
  })
  const MobilePromptHistoryEffect = fromZod(MobilePromptHistoryEntry).annotate({
    identifier: "MobilePromptHistoryEntry",
  })
  const MobilePromptStashEffect = fromZod(MobilePromptStashEntry).annotate({
    identifier: "MobilePromptStashEntry",
  })
  const MobileMemorySearchEffect = fromZod(MobileMemorySearchHit).annotate({
    identifier: "MobileMemorySearchHit",
  })
  const MobileCommandEffect = fromZod(MobileCommand).annotate({ identifier: "MobileCommand" })
  const MobileGithubBranchEffect = fromZod(MobileGithubBranch).annotate({
    identifier: "MobileGithubBranch",
  })
  const MobileGithubImportEffect = fromZod(MobileGithubImport).annotate({
    identifier: "MobileGithubImport",
  })
  const MobileGithubDeviceAuthStartEffect = fromZod(MobileGithubDeviceAuthStart).annotate({
    identifier: "MobileGithubDeviceAuthStart",
  })
  const MobileGithubDeviceAuthPollResultEffect = fromZod(MobileGithubDeviceAuthPollResult).annotate({
    identifier: "MobileGithubDeviceAuthPollResult",
  })
  const MobileGithubPublishInputEffect = fromZod(MobileGithubPublishInput).annotate({
    identifier: "MobileGithubPublishInput",
  })
  const MobileGithubPublishResultEffect = fromZod(MobileGithubPublishResult).annotate({
    identifier: "MobileGithubPublishResult",
  })
  const MobileGithubSessionCreateInputEffect = fromZod(MobileGithubSessionCreateInput).annotate({
    identifier: "MobileGithubSessionCreateInput",
  })
  const MobileGithubSessionCreateResultEffect = fromZod(MobileGithubSessionCreateResult).annotate({
    identifier: "MobileGithubSessionCreateResult",
  })
  const MobileSessionCreateInputEffect = fromZod(MobileSessionCreateInput).annotate({
    identifier: "MobileSessionCreateInput",
  })
  const MobileSessionMessageInputEffect = fromZod(SessionPending.PromptInput.omit({ sessionID: true })).annotate({
    identifier: "MobileSessionMessageInput",
  })
  const MobilePermissionRespondInputEffect = Schema.Struct({
    response: Schema.Literals(["once", "always", "reject"]),
  }).annotate({ identifier: "MobilePermissionRespondInput" })
  const MobileLoopWriteInputEffect = fromZod(MobileLoopWriteInput).annotate({
    identifier: "MobileLoopWriteInput",
  })
  const MobileLoopGenerateInputEffect = fromZod(MobileLoopGenerateInput).annotate({
    identifier: "MobileLoopGenerateInput",
  })
  const MobileLoopTemplateEffect = fromZod(MobileLoopTemplate).annotate({
    identifier: "MobileLoopTemplate",
  })
  const MobileLoopRuntimeEffect = fromZod(MobileLoopRuntime).annotate({
    identifier: "MobileLoopRuntime",
  })
  const MobileLoopRunEffect = fromZod(MobileLoopRun).annotate({ identifier: "MobileLoopRun" })
  const MobileRoutineEffect = fromZod(MobileRoutine).annotate({ identifier: "MobileRoutine" })
  const MobileRoutineCreateInputEffect = fromZod(MobileRoutineCreateInput).annotate({
    identifier: "MobileRoutineCreateInput",
  })
  const MobileRoutineUpdateInputEffect = fromZod(MobileRoutineUpdateInput).annotate({
    identifier: "MobileRoutineUpdateInput",
  })
  const MobileRoutineRunInputEffect = fromZod(MobileRoutineRunInput).annotate({
    identifier: "MobileRoutineRunInput",
  })
  const MobileRoutineTriggerInputEffect = fromZod(MobileRoutineTriggerInput).annotate({
    identifier: "MobileRoutineTriggerInput",
  })
  const MobileTeleportInputEffect = fromZod(MobileTeleportInput).annotate({
    identifier: "MobileTeleportInput",
  })
  const MobileTeleportOutInputEffect = fromZod(MobileTeleportOutInput).annotate({
    identifier: "MobileTeleportOutInput",
  })
  const MobileWorktreeCreateInputEffect = fromZod(MobileWorktreeCreateInput).annotate({
    identifier: "MobileWorktreeCreateInput",
  })
  const MobileWorktreeRemoveInputEffect = fromZod(MobileWorktreeRemoveInput).annotate({
    identifier: "MobileWorktreeRemoveInput",
  })
  const MobileWorktreeResetInputEffect = fromZod(MobileWorktreeResetInput).annotate({
    identifier: "MobileWorktreeResetInput",
  })
  const MobileMissionWriteInputEffect = fromZod(MobileMissionWriteInput).annotate({
    identifier: "MobileMissionWriteInput",
  })
  const MobileMissionUpdateInputEffect = fromZod(MobileMissionUpdateInput).annotate({
    identifier: "MobileMissionUpdateInput",
  })
  const MobileMissionGenerateInputEffect = fromZod(MobileMissionGenerateInput).annotate({
    identifier: "MobileMissionGenerateInput",
  })
  const MobileMissionFeatureMutateInputEffect = fromZod(MobileMissionFeatureMutateInput).annotate({
    identifier: "MobileMissionFeatureMutateInput",
  })
  const MobileMissionDefinitionEffect = fromZod(MissionDefinitionSchema).annotate({
    identifier: "MobileMissionDefinition",
  })
  const MobileMissionExecEffect = fromZod(MissionExecSchema).annotate({ identifier: "MobileMissionExec" })
  const MobileGithubImportRequestEffect = fromZod(MobileGithubImportRequest).annotate({
    identifier: "MobileGithubImportRequest",
  })

  const GithubUser = Schema.Struct({
    login: Schema.String,
    name: Schema.optional(Schema.NullOr(Schema.String)),
    avatar_url: Schema.optional(Schema.String),
  })

  /**
   * A project as the mobile surface sees it: the project record plus which one
   * the instance is currently bound to.
   *
   * The fields come from `Project.InfoSchema`, the service's own schema, rather
   * than being restated here — the producer is literally a spread of that
   * record (`{ ...Instance.project, current }` in `server/mobile/misc.ts`), so
   * a hand-written copy would be a third description of one object, free to
   * drift from both the service and `/project`.
   */
  const MobileProject = Schema.Struct({
    ...Project.InfoSchema.fields,
    current: Schema.Boolean,
  }).annotate({ identifier: "MobileProject" })

  const Bootstrap = Schema.Struct({
    version: Schema.String,
    auth: Schema.Struct({
      bearerEnabled: Schema.Boolean,
      currentToken: Schema.optional(PublicToken),
    }),
    currentProject: MobileProject,
    projects: Schema.Array(MobileProject),
    execution: Schema.Struct({
      container: Schema.Struct({
        available: Schema.Boolean,
        runtime: Schema.optional(Schema.Literals(["docker", "podman"])),
        image: Schema.String,
      }),
    }),
    github: Schema.Struct({
      connected: Schema.Boolean,
      tokenAvailable: Schema.optional(Schema.Boolean),
      reconnectRequired: Schema.optional(Schema.Boolean),
      oauthDeviceEnabled: Schema.Boolean,
      oauthDeviceConfigured: Schema.optional(Schema.Boolean),
      oauthClientSource: Schema.optional(Schema.Literals(["flag", "config", "env"])),
      user: Schema.optional(GithubUser),
    }),
    expo: Schema.Struct({
      available: Schema.Boolean,
      easAvailable: Schema.Boolean,
      details: Schema.Array(Schema.String),
    }),
    mobileProject: Schema.optional(
      Schema.Struct({
        detected: Schema.Boolean,
        platforms: Schema.optional(Schema.Array(Schema.String)),
        primaryPlatform: Schema.optional(Schema.String),
        method: Schema.optional(Schema.String),
        root: Schema.optional(Schema.String),
      }),
    ),
  }).annotate({ identifier: "MobileBootstrap" })

  const TeleportResult = Schema.Struct({
    sessionID: Schema.String,
    title: Schema.optional(Schema.String),
    messageCount: Schema.Number,
    directory: Schema.optional(Schema.String),
    workspace: Schema.Boolean,
  }).annotate({ identifier: "MobileTeleportResult" })

  const GitChange = Schema.Struct({
    status: Schema.Literals(["added", "modified", "deleted", "renamed"]),
    path: Schema.String,
    additions: Schema.optional(Schema.Number),
    deletions: Schema.optional(Schema.Number),
    oldPath: Schema.optional(Schema.String),
  }).annotate({ identifier: "MobileGitChange" })

  const GitStatus = Schema.Struct({
    branch: Schema.String,
    staged: Schema.Array(GitChange),
    unstaged: Schema.Array(GitChange),
    untracked: Schema.Array(Schema.String),
    commitsAhead: Schema.Number,
    commitsBehind: Schema.Number,
    lastCommit: Schema.optional(
      Schema.Struct({
        sha: Schema.String,
        message: Schema.String,
        author: Schema.String,
        timestamp: Schema.Number,
      }),
    ),
  }).annotate({ identifier: "MobileGitStatus" })

  const GitDiffLine = Schema.Struct({
    type: Schema.Literals(["add", "remove", "context"]),
    text: Schema.String,
    oldLineNumber: Schema.optional(Schema.Number),
    newLineNumber: Schema.optional(Schema.Number),
  })

  const GitFileDiff = Schema.Struct({
    file: Schema.String,
    oldPath: Schema.optional(Schema.String),
    hunks: Schema.Array(
      Schema.Struct({
        header: Schema.Struct({
          oldStart: Schema.Number,
          oldLines: Schema.Number,
          newStart: Schema.Number,
          newLines: Schema.Number,
        }),
        lines: Schema.Array(GitDiffLine),
      }),
    ),
    isBinary: Schema.Boolean,
    additions: Schema.Number,
    deletions: Schema.Number,
  }).annotate({ identifier: "MobileGitFileDiff" })

  const GitCommit = Schema.Struct({
    sha: Schema.String,
    message: Schema.String,
    author: Schema.Struct({ name: Schema.String, email: Schema.String }),
    timestamp: Schema.Number,
    filesCount: Schema.Number,
    additions: Schema.Number,
    deletions: Schema.Number,
  }).annotate({ identifier: "MobileGitCommit" })

  const GitBranch = Schema.Struct({
    name: Schema.String,
    isCurrent: Schema.Boolean,
    isProtected: Schema.Boolean,
    aheadBy: Schema.Number,
    behindBy: Schema.Number,
  }).annotate({ identifier: "MobileGitBranch" })

  const LoopRuntime = MobileLoopRuntimeEffect

  const MobileMissionRuntime = Schema.Struct({
    missionID: Schema.String,
    status: Schema.Literals(["idle", "running", "paused", "error", "cancelling"]),
    sessionID: Schema.optional(Schema.String),
    currentMilestoneID: Schema.optional(Schema.String),
    currentFeatureID: Schema.optional(Schema.String),
    doneFeatures: Schema.Number,
    totalFeatures: Schema.Number,
    lastError: Schema.optional(Schema.String),
    lastRunAt: Schema.optional(Schema.Number),
  }).annotate({ identifier: "MobileMissionRuntime" })

  const MobileMissionTemplate = Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.String,
    brief: Schema.String,
  }).annotate({ identifier: "MobileMissionTemplate" })

  const hostCapabilityFields = {
    available: Schema.Boolean,
    reason: Schema.optional(Schema.String),
  }

  export const Group = HttpApiGroup.make("mobile")
    // --- auth tokens ---
    .add(
      HttpApiEndpoint.get("authTokenList", "/auth/token", {
        success: Schema.Array(PublicToken),
      }).annotate(OpenApi.Identifier, "mobile.auth.token.list"),
    )
    .add(
      HttpApiEndpoint.post("authTokenCreate", "/auth/token", {
        payload: [
          HttpApiSchema.NoContent,
          Schema.Struct({
            name: Schema.optionalKey(Schema.String),
            expiresInDays: Schema.optionalKey(Schema.Number),
          }).annotate({ identifier: "MobileAuthTokenCreateInput" }),
        ],
        success: Schema.Struct({ token: Schema.String, info: PublicToken }),
      }).annotate(OpenApi.Identifier, "mobile.auth.token.create"),
    )
    .add(
      HttpApiEndpoint.delete("authTokenRevoke", "/auth/token/:id", {
        params: IDPath,
        success: Schema.Struct({ revoked: Schema.Boolean }),
      }).annotate(OpenApi.Identifier, "mobile.auth.token.revoke"),
    )
    // --- misc ---
    .add(
      HttpApiEndpoint.get("bootstrap", "/bootstrap", {
        success: Bootstrap,
      }).annotate(OpenApi.Identifier, "mobile.bootstrap"),
    )
    .add(
      HttpApiEndpoint.get("commandList", "/command", {
        success: Schema.Array(MobileCommandEffect),
      }).annotate(OpenApi.Identifier, "mobile.command.list"),
    )
    .add(
      HttpApiEndpoint.get("projectList", "/project", {
        success: Schema.Array(MobileProject),
      }).annotate(OpenApi.Identifier, "mobile.project.list"),
    )
    // --- memory ---
    .add(
      HttpApiEndpoint.get("memoryHistory", "/memory/history", {
        success: Schema.Array(MobilePromptHistoryEffect),
      }).annotate(OpenApi.Identifier, "mobile.memory.history"),
    )
    .add(
      HttpApiEndpoint.get("memorySearch", "/memory/search", {
        query: Schema.Struct({ query: Schema.String }),
        success: Schema.Array(MobileMemorySearchEffect),
      }).annotate(OpenApi.Identifier, "mobile.memory.search"),
    )
    .add(
      HttpApiEndpoint.get("memoryStashList", "/memory/stash", {
        success: Schema.Array(MobilePromptStashEffect),
      }).annotate(OpenApi.Identifier, "mobile.memory.stash.list"),
    )
    .add(
      HttpApiEndpoint.post("memoryStashCreate", "/memory/stash", {
        payload: Schema.Struct({ input: Schema.String }),
        success: MobilePromptStashEffect,
      }).annotate(OpenApi.Identifier, "mobile.memory.stash.create"),
    )
    .add(
      HttpApiEndpoint.delete("memoryStashDelete", "/memory/stash/:id", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.memory.stash.delete"),
    )
    // --- github ---
    .add(
      HttpApiEndpoint.get("githubRepos", "/github/repos", {
        // The upstream GitHub repo body is opaque to the server; typing the
        // row would mean restating a third-party schema, which is exactly the
        // drift the open-payload exception is meant to avoid. Justified.
        success: Schema.Array(Schema.Unknown),
        error: [Unauthorized, BadRequest],
      }).annotate(OpenApi.Identifier, "mobile.github.repos"),
    )
    .add(
      HttpApiEndpoint.get("githubBranches", "/github/repos/:owner/:repo/branches", {
        params: Schema.Struct({ owner: Schema.String, repo: Schema.String }),
        success: Schema.Array(MobileGithubBranchEffect),
        error: [Unauthorized, BadRequest],
      }).annotate(OpenApi.Identifier, "mobile.github.branches"),
    )
    .add(
      HttpApiEndpoint.get("githubImports", "/github/imports", {
        success: Schema.Array(MobileGithubImportEffect),
      }).annotate(OpenApi.Identifier, "mobile.github.imports"),
    )
    .add(
      HttpApiEndpoint.post("githubOauthClient", "/github/oauth/client", {
        payload: Schema.Struct({ clientId: Schema.String }),
        success: ConfigInfo,
      }).annotate(OpenApi.Identifier, "mobile.github.oauth.clientId.set"),
    )
    .add(
      HttpApiEndpoint.post("githubOauthDeviceStart", "/github/oauth/device", {
        success: MobileGithubDeviceAuthStartEffect,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.github.oauth.device.start"),
    )
    .add(
      HttpApiEndpoint.post("githubOauthDevicePoll", "/github/oauth/device/poll", {
        payload: Schema.Struct({ deviceCode: Schema.String }),
        success: MobileGithubDeviceAuthPollResultEffect,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.github.oauth.device.poll"),
    )
    .add(
      HttpApiEndpoint.post("githubAuthSet", "/github/auth", {
        payload: Schema.Struct({ token: Schema.String }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.github.auth.set"),
    )
    .add(
      HttpApiEndpoint.delete("githubAuthRemove", "/github/auth", {
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.github.auth.remove"),
    )
    .add(
      HttpApiEndpoint.post("githubImport", "/github/import", {
        payload: MobileGithubImportRequestEffect,
        success: Schema.Struct({ import: MobileGithubImportEffect, project: ProjectInfo }),
        error: Unauthorized,
      }).annotate(OpenApi.Identifier, "mobile.github.import"),
    )
    .add(
      HttpApiEndpoint.post("githubSessionCreate", "/github/session", {
        payload: MobileGithubSessionCreateInputEffect,
        success: MobileGithubSessionCreateResultEffect,
        error: Unauthorized,
      }).annotate(OpenApi.Identifier, "mobile.github.session.create"),
    )
    // --- sessions ---
    .add(
      HttpApiEndpoint.get("sessionList", "/session", {
        query: Schema.Struct({
          limit: Schema.optional(Schema.NumberFromString),
          search: Schema.optional(Schema.String),
        }),
        success: Schema.Array(MobileSessionSummaryEffect),
      }).annotate(OpenApi.Identifier, "mobile.session.list"),
    )
    .add(
      HttpApiEndpoint.post("sessionCreate", "/session", {
        payload: MobileSessionCreateInputEffect,
        success: SessionInfo,
      }).annotate(OpenApi.Identifier, "mobile.session.create"),
    )
    .add(
      HttpApiEndpoint.get("sessionDetail", "/session/:sessionID", {
        params: SessionIDPath,
        success: MobileSessionDetailEffect,
      }).annotate(OpenApi.Identifier, "mobile.session.detail"),
    )
    .add(
      HttpApiEndpoint.delete("sessionDelete", "/session/:sessionID", {
        params: SessionIDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.session.delete"),
    )
    .add(
      HttpApiEndpoint.get("sessionDiff", "/session/:sessionID/diff/:messageID", {
        params: Schema.Struct({
          sessionID: Schema.String,
          messageID: Schema.String,
        }),
        success: Schema.Array(Snapshot.FileDiffSchema),
      }).annotate(OpenApi.Identifier, "mobile.session.diff"),
    )
    .add(
      HttpApiEndpoint.get("sessionCommandList", "/session/:sessionID/command", {
        params: SessionIDPath,
        success: Schema.Array(MobileCommandEffect),
      }).annotate(OpenApi.Identifier, "mobile.session.command.list"),
    )
    .add(
      HttpApiEndpoint.post("sessionCommand", "/session/:sessionID/command", {
        params: SessionIDPath,
        payload: fromZod(MobileSessionCommandInput).annotate({
          identifier: "MobileSessionCommandInput",
        }),
        success: MessageV2.WithPartsSchema,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.session.command"),
    )
    .add(
      HttpApiEndpoint.post("sessionMessage", "/session/:sessionID/message", {
        params: SessionIDPath,
        payload: MobileSessionMessageInputEffect,
        success: Accepted,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.session.message"),
    )
    .add(
      HttpApiEndpoint.post("sessionAbort", "/session/:sessionID/abort", {
        params: SessionIDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.session.abort"),
    )
    .add(
      HttpApiEndpoint.post("permissionRespond", "/session/:sessionID/permissions/:permissionID", {
        params: Schema.Struct({
          sessionID: Schema.String,
          permissionID: Schema.String,
        }),
        payload: MobilePermissionRespondInputEffect,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.permission.respond"),
    )
    .add(
      HttpApiEndpoint.post("questionRespond", "/session/:sessionID/question/:requestID", {
        params: Schema.Struct({
          sessionID: Schema.String,
          requestID: Schema.String,
        }),
        payload: Schema.Struct({
          answers: Schema.Array(Schema.Array(Schema.String)),
        }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.question.respond"),
    )
    .add(
      HttpApiEndpoint.delete("questionReject", "/session/:sessionID/question/:requestID", {
        params: Schema.Struct({
          sessionID: Schema.String,
          requestID: Schema.String,
        }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.question.reject"),
    )
    .add(
      HttpApiEndpoint.post("sessionPublish", "/session/:sessionID/publish", {
        params: SessionIDPath,
        payload: MobileGithubPublishInputEffect,
        success: MobileGithubPublishResultEffect,
        error: [Unauthorized, BadRequest],
      }).annotate(OpenApi.Identifier, "mobile.github.session.publish"),
    )
    .add(
      HttpApiEndpoint.post("sessionCleanup", "/session/:sessionID/cleanup", {
        params: SessionIDPath,
        success: Success,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.github.session.cleanup"),
    )
    .add(
      HttpApiEndpoint.get("sessionStream", "/session/:sessionID/stream", {
        params: SessionIDPath,
        // SSE frames are `{ type, properties }` — the open-payload exception is
        // meant for exactly this. The stream encodes the bus event, not a
        // closed union.
        success: HttpApiSchema.StreamSse({ data: Schema.Unknown }),
      }).annotate(OpenApi.Identifier, "mobile.session.stream"),
    )
    .add(
      HttpApiEndpoint.post("sessionRename", "/session/:sessionID/rename", {
        params: SessionIDPath,
        payload: Schema.Struct({ title: Schema.String }),
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.session.rename"),
    )
    .add(
      HttpApiEndpoint.get("sessionTodo", "/session/:sessionID/todo", {
        params: SessionIDPath,
        success: Schema.Struct({ todos: Schema.Array(Todo.InfoSchema) }),
      }).annotate(OpenApi.Identifier, "mobile.session.todo"),
    )
    // --- teleport ---
    .add(
      HttpApiEndpoint.post("teleportUploadBegin", "/teleport/upload", {
        success: Schema.Struct({ uploadID: Schema.String }),
      }).annotate(OpenApi.Identifier, "mobile.session.teleport.upload.begin"),
    )
    .add(
      HttpApiEndpoint.post("teleportUploadChunk", "/teleport/upload/:uploadID", {
        params: Schema.Struct({ uploadID: Schema.String }),
        success: Schema.Struct({ ok: Schema.Boolean }),
      }).annotate(OpenApi.Identifier, "mobile.session.teleport.upload.chunk"),
    )
    .add(
      HttpApiEndpoint.post("teleportIn", "/teleport", {
        payload: MobileTeleportInputEffect,
        success: TeleportResult,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.session.teleport"),
    )
    .add(
      HttpApiEndpoint.post("teleportOut", "/session/:sessionID/teleport", {
        params: SessionIDPath,
        payload: MobileTeleportOutInputEffect,
        success: TeleportResult,
        error: [BadRequest, NotFound],
      }).annotate(OpenApi.Identifier, "mobile.session.teleport.out"),
    )
    // --- worktree ---
    .add(
      HttpApiEndpoint.post("worktreeCreate", "/worktree", {
        payload: [HttpApiSchema.NoContent, MobileWorktreeCreateInputEffect],
        success: WorktreeInfo,
      }).annotate(OpenApi.Identifier, "mobile.worktree.create"),
    )
    .add(
      HttpApiEndpoint.delete("worktreeRemove", "/worktree", {
        payload: MobileWorktreeRemoveInputEffect,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.worktree.remove"),
    )
    .add(
      HttpApiEndpoint.post("worktreeReset", "/worktree/reset", {
        payload: MobileWorktreeResetInputEffect,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.worktree.reset"),
    )
    // --- git ---
    .add(
      HttpApiEndpoint.get("gitStatus", "/git/status", {
        success: GitStatus,
      }).annotate(OpenApi.Identifier, "mobile.git.status"),
    )
    .add(
      HttpApiEndpoint.get("gitDiff", "/git/diff", {
        query: Schema.Struct({
          file: Schema.optional(Schema.String),
          staged: Schema.optional(Schema.Literals(["true", "false"])),
        }),
        success: Schema.Array(GitFileDiff),
      }).annotate(OpenApi.Identifier, "mobile.git.diff"),
    )
    .add(
      HttpApiEndpoint.get("gitCommits", "/git/commits", {
        query: Schema.Struct({
          limit: Schema.optional(Schema.NumberFromString),
        }),
        success: Schema.Array(GitCommit),
      }).annotate(OpenApi.Identifier, "mobile.git.commits"),
    )
    .add(
      HttpApiEndpoint.get("gitBranches", "/git/branches", {
        success: Schema.Array(GitBranch),
      }).annotate(OpenApi.Identifier, "mobile.git.branches"),
    )
    .add(
      HttpApiEndpoint.post("gitCommit", "/git/commit", {
        payload: Schema.Struct({
          message: Schema.String,
          files: Schema.optional(Schema.Array(Schema.String)),
          amend: Schema.optional(Schema.Boolean),
          stagedOnly: Schema.optional(Schema.Boolean),
        }),
        success: Schema.Struct({ sha: Schema.String, message: Schema.String }),
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.git.commit"),
    )
    .add(
      HttpApiEndpoint.post("gitCheckout", "/git/checkout", {
        payload: Schema.Struct({
          branch: Schema.String,
          create: Schema.optional(Schema.Boolean),
        }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.git.checkout"),
    )
    .add(
      HttpApiEndpoint.post("gitStage", "/git/stage", {
        payload: Schema.Struct({ files: Schema.Array(Schema.String) }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.git.stage"),
    )
    .add(
      HttpApiEndpoint.post("gitUnstage", "/git/unstage", {
        payload: Schema.Struct({ files: Schema.Array(Schema.String) }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.git.unstage"),
    )
    .add(
      HttpApiEndpoint.post("gitDiscard", "/git/discard", {
        payload: Schema.Struct({ files: Schema.Array(Schema.String) }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.git.discard"),
    )
    .add(
      HttpApiEndpoint.post("gitPush", "/git/push", {
        query: Schema.Struct({ upstream: Schema.optional(Schema.String) }),
        success: Schema.Struct({
          success: Schema.Literal(true),
          pushed: Schema.Boolean,
        }),
      }).annotate(OpenApi.Identifier, "mobile.git.push"),
    )
    .add(
      HttpApiEndpoint.post("gitPull", "/git/pull", {
        success: Schema.Struct({
          success: Schema.Literal(true),
          pulled: Schema.Boolean,
          conflicts: Schema.optional(Schema.Array(Schema.String)),
        }),
      }).annotate(OpenApi.Identifier, "mobile.git.pull"),
    )
    // --- loops ---
    .add(
      HttpApiEndpoint.get("loopList", "/loops", {
        success: Schema.Struct({
          loops: Schema.Array(LoopDefinition),
          runtimes: Schema.Array(LoopRuntime),
        }),
      }).annotate(OpenApi.Identifier, "mobile.loop.list"),
    )
    .add(
      HttpApiEndpoint.post("loopCreate", "/loops", {
        payload: MobileLoopWriteInputEffect,
        success: LoopDefinition,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.loop.create"),
    )
    .add(
      HttpApiEndpoint.get("loopTemplates", "/loops/templates", {
        success: Schema.Struct({ templates: Schema.Array(MobileLoopTemplateEffect) }),
      }).annotate(OpenApi.Identifier, "mobile.loop.templates"),
    )
    .add(
      HttpApiEndpoint.post("loopGenerate", "/loops/generate", {
        payload: MobileLoopGenerateInputEffect,
        success: LoopDefinition,
      }).annotate(OpenApi.Identifier, "mobile.loop.generate"),
    )
    .add(
      HttpApiEndpoint.get("loopRunsRecent", "/loops/runs/recent", {
        query: Schema.Struct({
          limit: Schema.optional(Schema.NumberFromString),
        }),
        success: Schema.Struct({ runs: Schema.Array(MobileLoopRunEffect) }),
      }).annotate(OpenApi.Identifier, "mobile.loop.runs.recent"),
    )
    .add(
      HttpApiEndpoint.get("loopGet", "/loops/:id", {
        params: IDPath,
        success: Schema.Struct({ loop: LoopDefinition, runtime: LoopRuntime }),
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.get"),
    )
    .add(
      HttpApiEndpoint.delete("loopDelete", "/loops/:id", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.delete"),
    )
    .add(
      HttpApiEndpoint.patch("loopUpdate", "/loops/:id", {
        params: IDPath,
        payload: MobileLoopWriteInputEffect,
        success: LoopDefinition,
        error: [BadRequest, NotFound],
      }).annotate(OpenApi.Identifier, "mobile.loop.update"),
    )
    .add(
      HttpApiEndpoint.get("loopRuns", "/loops/:id/runs", {
        params: IDPath,
        query: Schema.Struct({
          limit: Schema.optional(Schema.NumberFromString),
        }),
        success: Schema.Struct({ runs: Schema.Array(MobileLoopRunEffect) }),
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.runs"),
    )
    .add(
      HttpApiEndpoint.post("loopRun", "/loops/:id/run", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.run"),
    )
    .add(
      HttpApiEndpoint.post("loopAbort", "/loops/:id/abort", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.abort"),
    )
    .add(
      HttpApiEndpoint.post("loopToggle", "/loops/:id/toggle", {
        params: IDPath,
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: LoopDefinition,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.toggle"),
    )
    .add(
      HttpApiEndpoint.post("loopPause", "/loops/:id/pause", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.pause"),
    )
    .add(
      HttpApiEndpoint.post("loopResume", "/loops/:id/resume", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.loop.resume"),
    )
    // --- routines ---
    .add(
      HttpApiEndpoint.get("routineList", "/routines", {
        success: Schema.Array(MobileRoutineEffect),
      }).annotate(OpenApi.Identifier, "mobile.routine.list"),
    )
    .add(
      HttpApiEndpoint.post("routineCreate", "/routines", {
        payload: MobileRoutineCreateInputEffect,
        success: MobileRoutineEffect,
      }).annotate(OpenApi.Identifier, "mobile.routine.create"),
    )
    .add(
      HttpApiEndpoint.get("routineGet", "/routines/:id", {
        params: IDPath,
        success: MobileRoutineEffect,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.routine.get"),
    )
    .add(
      HttpApiEndpoint.delete("routineDelete", "/routines/:id", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.routine.delete"),
    )
    .add(
      HttpApiEndpoint.patch("routineUpdate", "/routines/:id", {
        params: IDPath,
        payload: MobileRoutineUpdateInputEffect,
        success: MobileRoutineEffect,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.routine.update"),
    )
    .add(
      HttpApiEndpoint.post("routineRun", "/routines/:id/run", {
        params: IDPath,
        payload: [HttpApiSchema.NoContent, MobileRoutineRunInputEffect],
        success: SessionInfo,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.routine.run"),
    )
    .add(
      HttpApiEndpoint.post("routinePause", "/routines/:id/pause", {
        params: IDPath,
        success: MobileRoutineEffect,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.routine.pause"),
    )
    .add(
      HttpApiEndpoint.post("routineResume", "/routines/:id/resume", {
        params: IDPath,
        success: MobileRoutineEffect,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.routine.resume"),
    )
    .add(
      HttpApiEndpoint.post("routineTrigger", "/routines/trigger/:token", {
        params: Schema.Struct({ token: Schema.String }),
        payload: [HttpApiSchema.NoContent, MobileRoutineTriggerInputEffect],
        success: SessionInfo,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.routine.trigger"),
    )
    // --- pty ---
    .add(
      HttpApiEndpoint.get("ptyList", "/pty", {
        success: Schema.Array(PtyInfo),
      }).annotate(OpenApi.Identifier, "mobile.pty.list"),
    )
    .add(
      HttpApiEndpoint.post("ptyCreate", "/pty", {
        payload: Schema.Struct({
          command: Schema.optional(Schema.String),
          args: Schema.optional(Schema.Array(Schema.String)),
          cwd: Schema.optional(Schema.String),
          title: Schema.optional(Schema.String),
          env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
        }),
        success: PtyInfo,
      }).annotate(OpenApi.Identifier, "mobile.pty.create"),
    )
    .add(
      HttpApiEndpoint.get("ptyGet", "/pty/:ptyID", {
        params: Schema.Struct({ ptyID: Schema.String }),
        success: PtyInfo,
      }).annotate(OpenApi.Identifier, "mobile.pty.get"),
    )
    .add(
      HttpApiEndpoint.put("ptyUpdate", "/pty/:ptyID", {
        params: Schema.Struct({ ptyID: Schema.String }),
        payload: Schema.Struct({
          title: Schema.optional(Schema.String),
          size: Schema.optional(Schema.Struct({ rows: Schema.Number, cols: Schema.Number })),
        }),
        success: PtyInfo,
      }).annotate(OpenApi.Identifier, "mobile.pty.update"),
    )
    .add(
      HttpApiEndpoint.delete("ptyRemove", "/pty/:ptyID", {
        params: Schema.Struct({ ptyID: Schema.String }),
        success: Schema.Boolean,
      }).annotate(OpenApi.Identifier, "mobile.pty.remove"),
    )
    .add(
      HttpApiEndpoint.get("ptyConnect", "/pty/:ptyID/connect", {
        params: Schema.Struct({ ptyID: Schema.String }),
        success: Schema.Unknown.annotate({ description: "WebSocket upgrade" }),
      }).annotate(OpenApi.Identifier, "mobile.pty.connect"),
    )
    // --- missions ---
    .add(
      HttpApiEndpoint.get("missionList", "/missions", {
        success: Schema.Struct({
          missions: Schema.Array(MobileMissionDefinitionEffect),
          runtimes: Schema.Array(MobileMissionRuntime),
        }),
      }).annotate(OpenApi.Identifier, "mobile.mission.list"),
    )
    .add(
      HttpApiEndpoint.post("missionCreate", "/missions", {
        payload: MobileMissionWriteInputEffect,
        success: MobileMissionDefinitionEffect,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.mission.create"),
    )
    .add(
      HttpApiEndpoint.get("missionTemplates", "/missions/templates", {
        success: Schema.Struct({ templates: Schema.Array(MobileMissionTemplate) }),
      }).annotate(OpenApi.Identifier, "mobile.mission.templates"),
    )
    .add(
      HttpApiEndpoint.post("missionGenerate", "/missions/generate", {
        payload: MobileMissionGenerateInputEffect,
        success: MobileMissionDefinitionEffect,
        error: BadRequest,
      }).annotate(OpenApi.Identifier, "mobile.mission.generate"),
    )
    .add(
      HttpApiEndpoint.get("missionExecsRecent", "/missions/execs/recent", {
        query: Schema.Struct({
          limit: Schema.optional(Schema.NumberFromString),
        }),
        success: Schema.Struct({ execs: Schema.Array(MobileMissionExecEffect) }),
      }).annotate(OpenApi.Identifier, "mobile.mission.execs.recent"),
    )
    .add(
      HttpApiEndpoint.get("missionGet", "/missions/:id", {
        params: IDPath,
        success: Schema.Struct({ mission: MobileMissionDefinitionEffect, runtime: MobileMissionRuntime }),
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.mission.get"),
    )
    .add(
      HttpApiEndpoint.patch("missionUpdate", "/missions/:id", {
        params: IDPath,
        payload: MobileMissionUpdateInputEffect,
        success: MobileMissionDefinitionEffect,
        error: [NotFound, BadRequest],
      }).annotate(OpenApi.Identifier, "mobile.mission.update"),
    )
    .add(
      HttpApiEndpoint.delete("missionDelete", "/missions/:id", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.mission.delete"),
    )
    .add(
      HttpApiEndpoint.get("missionExecs", "/missions/:id/execs", {
        params: IDPath,
        query: Schema.Struct({
          limit: Schema.optional(Schema.NumberFromString),
        }),
        success: Schema.Struct({ execs: Schema.Array(MobileMissionExecEffect) }),
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.mission.execs"),
    )
    .add(
      HttpApiEndpoint.post("missionStart", "/missions/:id/start", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.mission.start"),
    )
    .add(
      HttpApiEndpoint.post("missionPause", "/missions/:id/pause", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.mission.pause"),
    )
    .add(
      HttpApiEndpoint.post("missionCancel", "/missions/:id/cancel", {
        params: IDPath,
        success: Success,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mobile.mission.cancel"),
    )
    .add(
      HttpApiEndpoint.post("missionFeatureMutate", "/missions/:id/feature/:featureID", {
        params: Schema.Struct({ id: Schema.String, featureID: Schema.String }),
        payload: MobileMissionFeatureMutateInputEffect,
        success: MobileMissionDefinitionEffect,
        error: [NotFound, BadRequest],
      }).annotate(OpenApi.Identifier, "mobile.mission.feature.mutate"),
    )
    // --- live host events ---
    .add(
      HttpApiEndpoint.get("events", "/events", {
        success: HttpApiSchema.StreamSse({ data: Schema.Unknown }),
      }).annotate(OpenApi.Identifier, "mobile.events"),
    )
    // --- operator features ---
    .add(
      HttpApiEndpoint.get("brainStatus", "/brain", {
        success: Schema.Struct({
          enabled: Schema.Boolean,
          memoryEnabled: Schema.Boolean,
          minHours: Schema.Number,
          minSessions: Schema.Number,
          lastBrainAt: Schema.Number,
          hoursSinceLastBrain: Schema.Number,
          sessionsSinceLastBrain: Schema.Number,
          shouldTrigger: Schema.Boolean,
          model: Schema.optional(
            Schema.Struct({
              providerID: Schema.String,
              modelID: Schema.String,
            }),
          ),
        }),
      }).annotate(OpenApi.Identifier, "mobile.brain.get"),
    )
    .add(
      HttpApiEndpoint.post("brainTrigger", "/brain", {
        payload: Schema.optional(Schema.Struct({ force: Schema.optional(Schema.Boolean) })),
        success: Schema.Struct({
          success: Schema.Boolean,
          sessionsReviewed: Schema.Number,
          hoursSinceLastBrain: Schema.Number,
          error: Schema.optional(Schema.String),
          sessionID: Schema.optional(Schema.String),
        }),
      }).annotate(OpenApi.Identifier, "mobile.brain.trigger"),
    )
    .add(
      HttpApiEndpoint.get("chatBotList", "/chatbot/bots", {
        success: Schema.Struct({
          bots: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              type: Schema.String,
              running: Schema.Boolean,
              webhookPath: Schema.String,
            }),
          ),
        }),
      }).annotate(OpenApi.Identifier, "mobile.chatbot.list"),
    )
    .add(
      HttpApiEndpoint.post("chatBotStart", "/chatbot/bots/:name/start", {
        params: Schema.Struct({ name: Schema.String }),
        success: Schema.Struct({
          running: Schema.Boolean,
          error: Schema.optional(Schema.String),
        }),
      }).annotate(OpenApi.Identifier, "mobile.chatbot.start"),
    )
    .add(
      HttpApiEndpoint.post("chatBotStop", "/chatbot/bots/:name/stop", {
        params: Schema.Struct({ name: Schema.String }),
        success: Schema.Struct({ removed: Schema.Boolean }),
      }).annotate(OpenApi.Identifier, "mobile.chatbot.stop"),
    )
    .add(
      HttpApiEndpoint.get("observabilityGet", "/observability", {
        success: Schema.Struct({
          enabled: Schema.Boolean,
          otlpEndpoint: Schema.NullOr(Schema.String),
        }),
      }).annotate(OpenApi.Identifier, "mobile.observability.get"),
    )
    .add(
      HttpApiEndpoint.post("observabilitySet", "/observability", {
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: Schema.Struct({
          enabled: Schema.Boolean,
          otlpEndpoint: Schema.NullOr(Schema.String),
        }),
      }).annotate(OpenApi.Identifier, "mobile.observability.set"),
    )
    .add(
      HttpApiEndpoint.get("lspStatus", "/lsp", {
        success: Schema.Struct({
          servers: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              name: Schema.String,
              root: Schema.String,
              status: Schema.Literals(["connected", "error"]),
            }),
          ),
          error: Schema.optional(Schema.String),
        }),
      }).annotate(OpenApi.Identifier, "mobile.lsp.status"),
    )
    .add(
      HttpApiEndpoint.get("fusionList", "/fusion", {
        success: Schema.Struct({
          presets: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              builtin: Schema.Boolean,
              enabled: Schema.Boolean,
            }),
          ),
        }),
      }).annotate(OpenApi.Identifier, "mobile.fusion.list"),
    )
    .add(
      HttpApiEndpoint.post("fusionSet", "/fusion", {
        payload: Schema.Struct({ name: Schema.String, enabled: Schema.Boolean }),
        success: Schema.Struct({ name: Schema.String, enabled: Schema.Boolean }),
      }).annotate(OpenApi.Identifier, "mobile.fusion.set"),
    )
    // --- host status ---
    .add(
      HttpApiEndpoint.get("hostBrowser", "/host/browser", {
        success: Schema.Struct({
          ...hostCapabilityFields,
          sessions: Schema.optional(Schema.Array(Schema.Unknown)),
        }),
      }).annotate(OpenApi.Identifier, "mobile.host.browser"),
    )
    .add(
      HttpApiEndpoint.get("hostComputer", "/host/computer", {
        success: Schema.Struct({
          ...hostCapabilityFields,
          platform: Schema.optional(Schema.String),
          screenshot: Schema.optional(Schema.Boolean),
          input: Schema.optional(Schema.Boolean),
          detail: Schema.optional(Schema.String),
        }),
      }).annotate(OpenApi.Identifier, "mobile.host.computer"),
    )
    .add(
      HttpApiEndpoint.get("hostHerdrGet", "/host/herdr", {
        success: Schema.Struct({
          ...hostCapabilityFields,
          enabled: Schema.optional(Schema.Boolean),
          installed: Schema.optional(Schema.Boolean),
        }),
      }).annotate(OpenApi.Identifier, "mobile.host.herdr.get"),
    )
    .add(
      HttpApiEndpoint.post("hostHerdrSet", "/host/herdr", {
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: Schema.Struct({
          ...hostCapabilityFields,
          enabled: Schema.optional(Schema.Boolean),
          installed: Schema.optional(Schema.Boolean),
        }),
      }).annotate(OpenApi.Identifier, "mobile.host.herdr.set"),
    )
    .add(
      HttpApiEndpoint.get("hostIsland", "/host/island", {
        success: Schema.Struct({
          ...hostCapabilityFields,
          supported: Schema.optional(Schema.Boolean),
          enabled: Schema.optional(Schema.Boolean),
          appRunning: Schema.optional(Schema.Boolean),
          sessions: Schema.optional(Schema.Number),
        }),
      }).annotate(OpenApi.Identifier, "mobile.host.island"),
    )
    .add(
      HttpApiEndpoint.get("hostDevtools", "/host/devtools", {
        success: Schema.Struct({
          ...hostCapabilityFields,
          rss: Schema.optional(Schema.Number),
          heapUsed: Schema.optional(Schema.Number),
          heapTotal: Schema.optional(Schema.Number),
          external: Schema.optional(Schema.Number),
          pid: Schema.optional(Schema.Number),
          uptimeSec: Schema.optional(Schema.Number),
          platform: Schema.optional(Schema.String),
        }),
      }).annotate(OpenApi.Identifier, "mobile.host.devtools"),
    )
    .prefix("/mobile")

  export const Api = HttpApi.make("nikcli").add(Group)
}
