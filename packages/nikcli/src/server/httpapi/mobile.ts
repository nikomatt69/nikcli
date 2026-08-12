import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Schema } from "effect"

/**
 * Effect schema for the whole `/mobile/*` surface.
 *
 * Mobile-specific wrapper shapes are typed faithfully after
 * `mobile/helpers.ts`; domain objects that only exist as zod schemas
 * today (Session.Info, MessageV2.WithParts, Routine.Record, LoopDefinition,
 * Pty, Worktree.Info, Project.Info, Workspace.Info, …) stay `Schema.Unknown`
 * until the schema/protocol split gives them Effect definitions.
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

  const SessionIDPath = Schema.Struct({ sessionID: Schema.String })
  const IDPath = Schema.Struct({ id: Schema.String })

  // Domain objects still defined in zod only (schema split follow-up).
  const SessionInfo = Schema.Unknown.annotate({ identifier: "MobileSessionInfo" })
  const WorktreeInfo = Schema.Unknown.annotate({ identifier: "MobileWorktreeInfo" })
  const ProjectInfo = Schema.Unknown.annotate({ identifier: "MobileProjectInfo" })
  const WorkspaceInfo = Schema.Unknown.annotate({ identifier: "MobileWorkspaceInfo" })
  const PtyInfo = Schema.Unknown.annotate({ identifier: "MobilePtyInfo" })
  const RoutineRecord = Schema.Unknown.annotate({ identifier: "MobileRoutine" })
  const LoopDefinition = Schema.Unknown.annotate({ identifier: "MobileLoop" })
  const LoopRun = Schema.Unknown.annotate({ identifier: "MobileLoopRun" })
  const ConfigInfo = Schema.Unknown.annotate({ identifier: "MobileConfigInfo" })

  const PublicToken = Schema.Struct({
    id: Schema.String,
    name: Schema.optional(Schema.String),
    scope: Schema.optional(Schema.String),
    createdAt: Schema.optional(Schema.Number),
    expiresAt: Schema.optional(Schema.Number),
  }).annotate({ identifier: "MobileAuthTokenPublic" })

  const GithubUser = Schema.Struct({
    login: Schema.String,
    name: Schema.optional(Schema.NullOr(Schema.String)),
    avatar_url: Schema.optional(Schema.String),
  })

  const MobileProject = Schema.Unknown.annotate({ identifier: "MobileProject" })

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

  const Command = Schema.Struct({
    name: Schema.String,
    description: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    mcp: Schema.optional(Schema.Boolean),
    skill: Schema.optional(Schema.Boolean),
    subtask: Schema.optional(Schema.Boolean),
    hints: Schema.Array(Schema.String),
  }).annotate({ identifier: "MobileCommand" })

  const PromptHistoryEntry = Schema.Struct({
    id: Schema.String,
    input: Schema.String,
    mode: Schema.optional(Schema.Literals(["normal", "shell"])),
    partsCount: Schema.Number,
  }).annotate({ identifier: "MobilePromptHistoryEntry" })

  const PromptStashEntry = Schema.Struct({
    id: Schema.String,
    input: Schema.String,
    timestamp: Schema.Number,
    partsCount: Schema.Number,
  }).annotate({ identifier: "MobilePromptStashEntry" })

  const MemorySearchHit = Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
    sessionTitle: Schema.String,
    messageID: Schema.String,
    role: Schema.Literals(["user", "assistant"]),
    createdAt: Schema.Number,
    preview: Schema.String,
  }).annotate({ identifier: "MobileMemorySearchHit" })

  const GithubBranch = Schema.Struct({
    name: Schema.String,
    protected: Schema.optional(Schema.Boolean),
    commit: Schema.Struct({ sha: Schema.String }),
  }).annotate({ identifier: "MobileGithubBranch" })

  const GithubImport = Schema.Unknown.annotate({ identifier: "MobileGithubImport" })

  const GithubDeviceAuthStart = Schema.Struct({
    deviceCode: Schema.String,
    userCode: Schema.String,
    verificationUri: Schema.String,
    verificationUriComplete: Schema.optional(Schema.String),
    expiresAt: Schema.Number,
    interval: Schema.Number,
  }).annotate({ identifier: "MobileGithubDeviceAuthStart" })

  const GithubDeviceAuthPollResult = Schema.Struct({
    status: Schema.Literals(["pending", "approved", "denied", "expired"]),
    interval: Schema.optional(Schema.Number),
    user: Schema.optional(GithubUser),
  }).annotate({ identifier: "MobileGithubDeviceAuthPollResult" })

  const ExecutionTarget = Schema.Literals(["local", "container"])

  const GithubSessionCreateInput = Schema.Struct({
    owner: Schema.String,
    repo: Schema.String,
    cloneUrl: Schema.String,
    htmlUrl: Schema.optional(Schema.String),
    defaultBranch: Schema.String,
    baseBranch: Schema.String,
    private: Schema.optional(Schema.Boolean),
    title: Schema.optional(Schema.String),
    executionTarget: Schema.optional(ExecutionTarget),
  }).annotate({ identifier: "MobileGithubSessionCreateInput" })

  const GithubSessionCreateResult = Schema.Struct({
    session: SessionInfo,
    worktree: WorktreeInfo,
    project: ProjectInfo,
    workspace: Schema.optional(WorkspaceInfo),
  }).annotate({ identifier: "MobileGithubSessionCreateResult" })

  const SessionSummary = Schema.Struct({
    info: SessionInfo,
    status: Schema.optional(Schema.Unknown),
  }).annotate({ identifier: "MobileSessionSummary" })

  const SessionDetail = Schema.Struct({
    info: SessionInfo,
    status: Schema.optional(Schema.Unknown),
    messages: Schema.Array(Schema.Unknown),
    artifacts: Schema.Array(Schema.Unknown),
    permissions: Schema.Array(Schema.Unknown),
    questions: Schema.Array(Schema.Unknown),
  }).annotate({ identifier: "MobileSessionDetail" })

  const SessionCreateInput = Schema.Struct({
    parentID: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    permission: Schema.optional(Schema.Unknown),
    github: Schema.optional(Schema.Unknown),
    executionTarget: Schema.optional(ExecutionTarget),
  }).annotate({ identifier: "MobileSessionCreateInput" })

  const SessionCommandInput = Schema.Struct({
    command: Schema.String,
    arguments: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
    variant: Schema.optional(Schema.String),
  }).annotate({ identifier: "MobileSessionCommandInput" })

  const PromptPayload = Schema.Struct({
    messageID: Schema.optional(Schema.String),
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
    agent: Schema.optional(Schema.String),
    noReply: Schema.optional(Schema.Boolean),
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
    format: Schema.optional(Schema.Unknown),
    system: Schema.optional(Schema.String),
    variant: Schema.optional(Schema.String),
    parts: Schema.Array(Schema.Unknown),
  }).annotate({ identifier: "MobileSessionMessageInput" })

  const GithubPublishInput = Schema.Struct({
    title: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
    commitMessage: Schema.optional(Schema.String),
  }).annotate({ identifier: "MobileGithubPublishInput" })

  const GithubPublishResult = Schema.Struct({
    commitSha: Schema.String,
    branch: Schema.String,
    pullRequest: Schema.Struct({
      number: Schema.Number,
      url: Schema.String,
      title: Schema.String,
    }),
  }).annotate({ identifier: "MobileGithubPublishResult" })

  const TeleportResult = Schema.Struct({
    sessionID: Schema.String,
    title: Schema.optional(Schema.String),
    messageCount: Schema.Number,
    directory: Schema.optional(Schema.String),
    workspace: Schema.Boolean,
  }).annotate({ identifier: "MobileTeleportResult" })

  const TeleportInPayload = Schema.Struct({
    title: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    origin: Schema.optional(Schema.String),
    permission: Schema.optional(Schema.Unknown),
    messages: Schema.Array(Schema.Unknown),
    uploadID: Schema.optional(Schema.String),
  }).annotate({ identifier: "MobileTeleportInput" })

  const TeleportOutPayload = Schema.Struct({
    url: Schema.String,
    token: Schema.String,
    content: Schema.optional(Schema.Boolean),
    includeGit: Schema.optional(Schema.Boolean),
  }).annotate({ identifier: "MobileTeleportOutInput" })

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

  const LoopRuntime = Schema.Struct({
    loopID: Schema.String,
    status: Schema.Literals(["idle", "running", "paused", "error", "cancelling"]),
    runs: Schema.Number,
    lastRunAt: Schema.optional(Schema.Number),
    lastError: Schema.optional(Schema.String),
    sessionID: Schema.optional(Schema.String),
  }).annotate({ identifier: "MobileLoopRuntime" })

  export const Group = HttpApiGroup.make("mobile")
    // --- auth tokens ---
    .add(
      HttpApiEndpoint.get("authTokenList", "/auth/token", {
        success: Schema.Array(PublicToken),
      }).annotate(OpenApi.Identifier, "mobile.auth.token.list"),
    )
    .add(
      HttpApiEndpoint.post("authTokenCreate", "/auth/token", {
        payload: Schema.Struct({
          name: Schema.optional(Schema.String),
          expiresInDays: Schema.optional(Schema.Number),
        }),
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
        success: Schema.Array(Command),
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
        success: Schema.Array(PromptHistoryEntry),
      }).annotate(OpenApi.Identifier, "mobile.memory.history"),
    )
    .add(
      HttpApiEndpoint.get("memorySearch", "/memory/search", {
        query: Schema.Struct({ query: Schema.String }),
        success: Schema.Array(MemorySearchHit),
      }).annotate(OpenApi.Identifier, "mobile.memory.search"),
    )
    .add(
      HttpApiEndpoint.get("memoryStashList", "/memory/stash", {
        success: Schema.Array(PromptStashEntry),
      }).annotate(OpenApi.Identifier, "mobile.memory.stash.list"),
    )
    .add(
      HttpApiEndpoint.post("memoryStashCreate", "/memory/stash", {
        payload: Schema.Struct({ input: Schema.String }),
        success: PromptStashEntry,
      }).annotate(OpenApi.Identifier, "mobile.memory.stash.create"),
    )
    .add(
      HttpApiEndpoint.delete("memoryStashDelete", "/memory/stash/:id", {
        params: IDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.memory.stash.delete"),
    )
    // --- github ---
    .add(
      HttpApiEndpoint.get("githubRepos", "/github/repos", {
        success: Schema.Array(Schema.Unknown),
      }).annotate(OpenApi.Identifier, "mobile.github.repos"),
    )
    .add(
      HttpApiEndpoint.get("githubBranches", "/github/repos/:owner/:repo/branches", {
        params: Schema.Struct({ owner: Schema.String, repo: Schema.String }),
        success: Schema.Array(GithubBranch),
      }).annotate(OpenApi.Identifier, "mobile.github.branches"),
    )
    .add(
      HttpApiEndpoint.get("githubImports", "/github/imports", {
        success: Schema.Array(GithubImport),
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
        success: GithubDeviceAuthStart,
      }).annotate(OpenApi.Identifier, "mobile.github.oauth.device.start"),
    )
    .add(
      HttpApiEndpoint.post("githubOauthDevicePoll", "/github/oauth/device/poll", {
        payload: Schema.Struct({ deviceCode: Schema.String }),
        success: GithubDeviceAuthPollResult,
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
        payload: Schema.Unknown.annotate({ description: "MobileGithubRepo.ImportRequest" }),
        success: Schema.Struct({ import: GithubImport, project: ProjectInfo }),
      }).annotate(OpenApi.Identifier, "mobile.github.import"),
    )
    .add(
      HttpApiEndpoint.post("githubSessionCreate", "/github/session", {
        payload: GithubSessionCreateInput,
        success: GithubSessionCreateResult,
      }).annotate(OpenApi.Identifier, "mobile.github.session.create"),
    )
    // --- sessions ---
    .add(
      HttpApiEndpoint.get("sessionList", "/session", {
        query: Schema.Struct({
          limit: Schema.optional(Schema.NumberFromString),
          search: Schema.optional(Schema.String),
        }),
        success: Schema.Array(SessionSummary),
      }).annotate(OpenApi.Identifier, "mobile.session.list"),
    )
    .add(
      HttpApiEndpoint.post("sessionCreate", "/session", {
        payload: SessionCreateInput,
        success: SessionInfo,
      }).annotate(OpenApi.Identifier, "mobile.session.create"),
    )
    .add(
      HttpApiEndpoint.get("sessionDetail", "/session/:sessionID", {
        params: SessionIDPath,
        success: SessionDetail,
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
        params: Schema.Struct({ sessionID: Schema.String, messageID: Schema.String }),
        success: Schema.Array(Schema.Unknown),
      }).annotate(OpenApi.Identifier, "mobile.session.diff"),
    )
    .add(
      HttpApiEndpoint.get("sessionCommandList", "/session/:sessionID/command", {
        params: SessionIDPath,
        success: Schema.Array(Command),
      }).annotate(OpenApi.Identifier, "mobile.session.command.list"),
    )
    .add(
      HttpApiEndpoint.post("sessionCommand", "/session/:sessionID/command", {
        params: SessionIDPath,
        payload: SessionCommandInput,
        success: Schema.Struct({
          info: Schema.Unknown,
          parts: Schema.Array(Schema.Unknown),
        }),
      }).annotate(OpenApi.Identifier, "mobile.session.command"),
    )
    .add(
      HttpApiEndpoint.post("sessionMessage", "/session/:sessionID/message", {
        params: SessionIDPath,
        payload: PromptPayload,
        success: Schema.Unknown,
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
        params: Schema.Struct({ sessionID: Schema.String, permissionID: Schema.String }),
        payload: Schema.Struct({ response: Schema.String }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.permission.respond"),
    )
    .add(
      HttpApiEndpoint.post("questionRespond", "/session/:sessionID/question/:requestID", {
        params: Schema.Struct({ sessionID: Schema.String, requestID: Schema.String }),
        payload: Schema.Struct({ answers: Schema.Array(Schema.Array(Schema.String)) }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.question.respond"),
    )
    .add(
      HttpApiEndpoint.delete("questionReject", "/session/:sessionID/question/:requestID", {
        params: Schema.Struct({ sessionID: Schema.String, requestID: Schema.String }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.question.reject"),
    )
    .add(
      HttpApiEndpoint.post("sessionPublish", "/session/:sessionID/publish", {
        params: SessionIDPath,
        payload: GithubPublishInput,
        success: GithubPublishResult,
      }).annotate(OpenApi.Identifier, "mobile.github.session.publish"),
    )
    .add(
      HttpApiEndpoint.post("sessionCleanup", "/session/:sessionID/cleanup", {
        params: SessionIDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.github.session.cleanup"),
    )
    .add(
      HttpApiEndpoint.get("sessionStream", "/session/:sessionID/stream", {
        params: SessionIDPath,
        success: HttpApiSchema.StreamSse({ data: Schema.Unknown }),
      }).annotate(OpenApi.Identifier, "mobile.session.stream"),
    )
    .add(
      HttpApiEndpoint.post("sessionRename", "/session/:sessionID/rename", {
        params: SessionIDPath,
        payload: Schema.Struct({ title: Schema.String }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.session.rename"),
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
        payload: TeleportInPayload,
        success: TeleportResult,
      }).annotate(OpenApi.Identifier, "mobile.session.teleport"),
    )
    .add(
      HttpApiEndpoint.post("teleportOut", "/session/:sessionID/teleport", {
        params: SessionIDPath,
        payload: TeleportOutPayload,
        success: TeleportResult,
      }).annotate(OpenApi.Identifier, "mobile.session.teleport.out"),
    )
    // --- worktree ---
    .add(
      HttpApiEndpoint.post("worktreeCreate", "/worktree", {
        payload: Schema.Unknown.annotate({ description: "WorktreeCreateInput" }),
        success: WorktreeInfo,
      }).annotate(OpenApi.Identifier, "mobile.worktree.create"),
    )
    .add(
      HttpApiEndpoint.delete("worktreeRemove", "/worktree", {
        payload: Schema.Unknown.annotate({ description: "WorktreeRemoveInput" }),
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.worktree.remove"),
    )
    .add(
      HttpApiEndpoint.post("worktreeReset", "/worktree/reset", {
        payload: Schema.Unknown.annotate({ description: "WorktreeResetInput" }),
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
        success: Schema.Struct({ success: Schema.Literal(true), pushed: Schema.Boolean }),
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
        payload: Schema.Unknown.annotate({ description: "MobileLoopWriteInput" }),
        success: LoopDefinition,
      }).annotate(OpenApi.Identifier, "mobile.loop.create"),
    )
    .add(
      HttpApiEndpoint.get("loopTemplates", "/loops/templates", {
        success: Schema.Struct({ templates: Schema.Array(Schema.Unknown) }),
      }).annotate(OpenApi.Identifier, "mobile.loop.templates"),
    )
    .add(
      HttpApiEndpoint.post("loopGenerate", "/loops/generate", {
        payload: Schema.Struct({
          description: Schema.String,
          model: Schema.optional(Schema.String),
        }),
        success: LoopDefinition,
      }).annotate(OpenApi.Identifier, "mobile.loop.generate"),
    )
    .add(
      HttpApiEndpoint.get("loopRunsRecent", "/loops/runs/recent", {
        query: Schema.Struct({ limit: Schema.optional(Schema.NumberFromString) }),
        success: Schema.Struct({ runs: Schema.Array(LoopRun) }),
      }).annotate(OpenApi.Identifier, "mobile.loop.runs.recent"),
    )
    .add(
      HttpApiEndpoint.get("loopGet", "/loops/:id", {
        params: IDPath,
        success: Schema.Struct({ loop: LoopDefinition, runtime: LoopRuntime }),
      }).annotate(OpenApi.Identifier, "mobile.loop.get"),
    )
    .add(
      HttpApiEndpoint.delete("loopDelete", "/loops/:id", {
        params: IDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.loop.delete"),
    )
    .add(
      HttpApiEndpoint.patch("loopUpdate", "/loops/:id", {
        params: IDPath,
        payload: Schema.Unknown.annotate({ description: "MobileLoopWriteInput" }),
        success: LoopDefinition,
      }).annotate(OpenApi.Identifier, "mobile.loop.update"),
    )
    .add(
      HttpApiEndpoint.get("loopRuns", "/loops/:id/runs", {
        params: IDPath,
        query: Schema.Struct({ limit: Schema.optional(Schema.NumberFromString) }),
        success: Schema.Struct({ runs: Schema.Array(LoopRun) }),
      }).annotate(OpenApi.Identifier, "mobile.loop.runs"),
    )
    .add(
      HttpApiEndpoint.post("loopRun", "/loops/:id/run", {
        params: IDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.loop.run"),
    )
    .add(
      HttpApiEndpoint.post("loopAbort", "/loops/:id/abort", {
        params: IDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.loop.abort"),
    )
    .add(
      HttpApiEndpoint.post("loopToggle", "/loops/:id/toggle", {
        params: IDPath,
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: LoopDefinition,
      }).annotate(OpenApi.Identifier, "mobile.loop.toggle"),
    )
    .add(
      HttpApiEndpoint.post("loopPause", "/loops/:id/pause", {
        params: IDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.loop.pause"),
    )
    .add(
      HttpApiEndpoint.post("loopResume", "/loops/:id/resume", {
        params: IDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.loop.resume"),
    )
    // --- routines ---
    .add(
      HttpApiEndpoint.get("routineList", "/routines", {
        success: Schema.Array(RoutineRecord),
      }).annotate(OpenApi.Identifier, "mobile.routine.list"),
    )
    .add(
      HttpApiEndpoint.post("routineCreate", "/routines", {
        payload: Schema.Unknown.annotate({ description: "MobileRoutineCreateInput" }),
        success: RoutineRecord,
      }).annotate(OpenApi.Identifier, "mobile.routine.create"),
    )
    .add(
      HttpApiEndpoint.get("routineGet", "/routines/:id", {
        params: IDPath,
        success: RoutineRecord,
      }).annotate(OpenApi.Identifier, "mobile.routine.get"),
    )
    .add(
      HttpApiEndpoint.delete("routineDelete", "/routines/:id", {
        params: IDPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "mobile.routine.delete"),
    )
    .add(
      HttpApiEndpoint.patch("routineUpdate", "/routines/:id", {
        params: IDPath,
        payload: Schema.Unknown.annotate({ description: "MobileRoutineUpdateInput" }),
        success: RoutineRecord,
      }).annotate(OpenApi.Identifier, "mobile.routine.update"),
    )
    .add(
      HttpApiEndpoint.post("routineRun", "/routines/:id/run", {
        params: IDPath,
        payload: Schema.Struct({ text: Schema.optional(Schema.String) }),
        success: SessionInfo,
      }).annotate(OpenApi.Identifier, "mobile.routine.run"),
    )
    .add(
      HttpApiEndpoint.post("routinePause", "/routines/:id/pause", {
        params: IDPath,
        success: RoutineRecord,
      }).annotate(OpenApi.Identifier, "mobile.routine.pause"),
    )
    .add(
      HttpApiEndpoint.post("routineResume", "/routines/:id/resume", {
        params: IDPath,
        success: RoutineRecord,
      }).annotate(OpenApi.Identifier, "mobile.routine.resume"),
    )
    .add(
      HttpApiEndpoint.post("routineTrigger", "/routines/trigger/:token", {
        params: Schema.Struct({ token: Schema.String }),
        payload: Schema.Struct({ text: Schema.optional(Schema.String) }),
        success: SessionInfo,
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
    .prefix("/mobile")

  export const Api = HttpApi.make("nikcli").add(Group)
}
