import type {
  TopLevelDisposeOutput,
  TopLevelPathOutput,
  TopLevelVcsOutput,
  TopLevelVcsStatusOutput,
  TopLevelVcsDiffRawOutput,
  TopLevelVcsApplyInput,
  TopLevelVcsApplyOutput,
  TopLevelCommandOutput,
  TopLevelAgentOutput,
  TopLevelSkillOutput,
  TopLevelLspOutput,
  TopLevelFormatterOutput,
  AnalyticsGlobalOutput,
  AnalyticsDailyInput,
  AnalyticsDailyOutput,
  AnalyticsSessionInput,
  AnalyticsSessionOutput,
  AnalyticsSessionsOutput,
  AnalyticsLeaderboardOutput,
  AppLogInput,
  AppLogOutput,
  AppSkillCreateInput,
  AppSkillCreateOutput,
  AppSkillDeleteInput,
  AppSkillDeleteOutput,
  BrainStatusOutput,
  BrainTriggerInput,
  BrainTriggerOutput,
  ConfigGetOutput,
  ConfigUpdateInput,
  ConfigUpdateOutput,
  ConfigProvidersOutput,
  ConnectorsStatusOutput,
  ConnectorsAuthSetInput,
  ConnectorsAuthSetOutput,
  ConnectorsAuthRemoveInput,
  ConnectorsAuthRemoveOutput,
  ConnectorsInvalidateInput,
  ConnectorsInvalidateOutput,
  DoctorRunOutput,
  ExperimentalToolIDsOutput,
  ExperimentalToolsInput,
  ExperimentalToolsOutput,
  ExperimentalWorktreeCreateInput,
  ExperimentalWorktreeCreateOutput,
  ExperimentalWorktreeOutput,
  ExperimentalWorktreeRemoveInput,
  ExperimentalWorktreeRemoveOutput,
  ExperimentalWorktreeResetInput,
  ExperimentalWorktreeResetOutput,
  ExperimentalResourceOutput,
  ExperimentalManagedWorktreeCreateInput,
  ExperimentalManagedWorktreeCreateOutput,
  ExperimentalManagedWorktreeRemoveInput,
  ExperimentalManagedWorktreeRemoveOutput,
  ExperimentalManagedWorktreeLinkInput,
  ExperimentalManagedWorktreeLinkOutput,
  ExperimentalManagedWorktreeChildrenInput,
  ExperimentalManagedWorktreeChildrenOutput,
  ExperimentalManagedWorktreeAncestorsInput,
  ExperimentalManagedWorktreeAncestorsOutput,
  ExperimentalManagedWorktreeListOutput,
  FileFindTextInput,
  FileFindTextOutput,
  FileFindFileInput,
  FileFindFileOutput,
  FileFindSymbolInput,
  FileFindSymbolOutput,
  FileListInput,
  FileListOutput,
  FileContentInput,
  FileContentOutput,
  FileWriteInput,
  FileWriteOutput,
  FileStatusOutput,
  GlobalHealthOutput,
  GlobalDisposeOutput,
  McpStatusOutput,
  McpAddInput,
  McpAddOutput,
  McpStartAuthInput,
  McpStartAuthOutput,
  McpAuthCallbackInput,
  McpAuthCallbackOutput,
  McpAuthenticateInput,
  McpAuthenticateOutput,
  McpRemoveAuthInput,
  McpRemoveAuthOutput,
  McpConnectInput,
  McpConnectOutput,
  McpDisconnectInput,
  McpDisconnectOutput,
  McpToggleInput,
  McpToggleOutput,
  MissionListOutput,
  MissionTemplatesOutput,
  MissionGenerateInput,
  MissionGenerateOutput,
  MissionRecentExecsInput,
  MissionRecentExecsOutput,
  MissionGetInput,
  MissionGetOutput,
  MissionUpsertInput,
  MissionUpsertOutput,
  MissionUpdateInput,
  MissionUpdateOutput,
  MissionRemoveInput,
  MissionRemoveOutput,
  MissionStartInput,
  MissionStartOutput,
  MissionPauseInput,
  MissionPauseOutput,
  MissionCancelInput,
  MissionCancelOutput,
  MissionFeatureMutateInput,
  MissionFeatureMutateOutput,
  MissionExecsInput,
  MissionExecsOutput,
  ProjectListOutput,
  ProjectCurrentOutput,
  ProjectUpdateInput,
  ProjectUpdateOutput,
  ProviderListOutput,
  ProviderAuthOutput,
  ProviderApiInput,
  ProviderApiOutput,
  ProviderRemoveAuthInput,
  ProviderRemoveAuthOutput,
  ProviderOauthAuthorizeInput,
  ProviderOauthAuthorizeOutput,
  ProviderOauthCallbackInput,
  ProviderOauthCallbackOutput,
  QuestionListOutput,
  QuestionReplyInput,
  QuestionReplyOutput,
  QuestionRejectInput,
  QuestionRejectOutput,
  PermissionListOutput,
  PermissionReplyInput,
  PermissionReplyOutput,
  PtyListOutput,
  PtyCreateInput,
  PtyCreateOutput,
  PtyGetInput,
  PtyGetOutput,
  PtyUpdateInput,
  PtyUpdateOutput,
  PtyRemoveInput,
  PtyRemoveOutput,
  LoopListOutput,
  LoopTemplatesOutput,
  LoopGenerateInput,
  LoopGenerateOutput,
  LoopRecentRunsInput,
  LoopRecentRunsOutput,
  LoopGetInput,
  LoopGetOutput,
  LoopUpsertInput,
  LoopUpsertOutput,
  LoopUpdateInput,
  LoopUpdateOutput,
  LoopRemoveInput,
  LoopRemoveOutput,
  LoopToggleInput,
  LoopToggleOutput,
  LoopRunInput,
  LoopRunOutput,
  LoopAbortInput,
  LoopAbortOutput,
  LoopPauseInput,
  LoopPauseOutput,
  LoopResumeInput,
  LoopResumeOutput,
  LoopRunsInput,
  LoopRunsOutput,
  SessionListInput,
  SessionListOutput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionStatusOutput,
  SessionGetInput,
  SessionGetOutput,
  SessionRemoveInput,
  SessionRemoveOutput,
  SessionUpdateInput,
  SessionUpdateOutput,
  SessionForkInput,
  SessionForkOutput,
  SessionAbortInput,
  SessionAbortOutput,
  SessionRevertInput,
  SessionRevertOutput,
  SessionUnrevertInput,
  SessionUnrevertOutput,
  SessionShareInput,
  SessionShareOutput,
  SessionUnshareInput,
  SessionUnshareOutput,
  SessionSummarizeInput,
  SessionSummarizeOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionShellInput,
  SessionShellOutput,
  SessionPermissionRespondInput,
  SessionPermissionRespondOutput,
  SessionChildrenInput,
  SessionChildrenOutput,
  SessionTodoInput,
  SessionTodoOutput,
  SessionDiffInput,
  SessionDiffOutput,
  SessionMessagesInput,
  SessionMessagesOutput,
  SessionMessageInput,
  SessionMessageOutput,
  SessionMessageRemoveInput,
  SessionMessageRemoveOutput,
  SessionPartRemoveInput,
  SessionPartRemoveOutput,
  SessionPartUpdateInput,
  SessionPartUpdateOutput,
  SessionV2EntriesInput,
  SessionV2EntriesOutput,
  SessionV2StateInput,
  SessionV2StateOutput,
  SessionV2EventsInput,
  SessionV2EventsOutput,
  SessionInstructionsInput,
  SessionInstructionsOutput,
  SessionContextBreakdownInput,
  SessionContextBreakdownOutput,
  SessionContextToggleInput,
  SessionContextToggleOutput,
  SessionGoalInput,
  SessionGoalOutput,
  SessionBackgroundInput,
  SessionBackgroundOutput,
  SessionBackgroundInspectInput,
  SessionBackgroundInspectOutput,
  SessionBackgroundReadInput,
  SessionBackgroundReadOutput,
  SessionBackgroundCancelInput,
  SessionBackgroundCancelOutput,
  SessionMonitorInput,
  SessionMonitorOutput,
  SessionMonitorLogInput,
  SessionMonitorLogOutput,
  SessionMonitorCancelInput,
  SessionMonitorCancelOutput,
  SyncStartInput,
  SyncStartOutput,
  SyncReplayInput,
  SyncReplayOutput,
  SyncHistoryInput,
  SyncHistoryOutput,
  SyncSnapshotInput,
  SyncSnapshotOutput,
  TuiAppendPromptInput,
  TuiAppendPromptOutput,
  TuiOpenHelpOutput,
  TuiOpenSessionsOutput,
  TuiOpenThemesOutput,
  TuiOpenModelsOutput,
  TuiSubmitPromptOutput,
  TuiClearPromptOutput,
  TuiExecuteCommandInput,
  TuiExecuteCommandOutput,
  TuiShowToastInput,
  TuiShowToastOutput,
  TuiPublishInput,
  TuiPublishOutput,
  TuiSelectSessionInput,
  TuiSelectSessionOutput,
  TuiControlNextOutput,
  TuiControlResponseInput,
  TuiControlResponseOutput,
  WorkspaceAdaptorsOutput,
  WorkspaceSyncListOutput,
  WorkspaceStatusOutput,
  WorkspaceCreateInput,
  WorkspaceCreateOutput,
  WorkspaceListOutput,
  WorkspaceRemoveInput,
  WorkspaceRemoveOutput,
  WorkspaceRestoreInput,
  WorkspaceRestoreOutput,
  WorkspaceSessionRestoreInput,
  WorkspaceSessionRestoreOutput,
  WorkspaceWarpInput,
  WorkspaceWarpOutput,
} from "./types.js"
import { ClientError } from "./client-error.js"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: RequestInit["headers"]
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit["headers"]
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
  readonly text?: true
}

const maxSseEventBytes = 16 * 1024 * 1024

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const url = new URL(descriptor.path, options.baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status)) throw await json(response)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.text) return (await response.text()) as A
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType")
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > maxSseEventBytes) throw new ClientError("SseEventTooLarge")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    "top-level": {
      dispose: (requestOptions?: RequestOptions) =>
        request<TopLevelDisposeOutput>(
          { method: "POST", path: `/instance/dispose`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      path: (requestOptions?: RequestOptions) =>
        request<TopLevelPathOutput>(
          { method: "GET", path: `/path`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      vcs: (requestOptions?: RequestOptions) =>
        request<TopLevelVcsOutput>(
          { method: "GET", path: `/vcs`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      vcsStatus: (requestOptions?: RequestOptions) =>
        request<TopLevelVcsStatusOutput>(
          { method: "GET", path: `/vcs/status`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      vcsDiffRaw: (requestOptions?: RequestOptions) =>
        request<TopLevelVcsDiffRawOutput>(
          { method: "GET", path: `/vcs/diff/raw`, successStatus: 200, declaredStatuses: [], empty: false, text: true },
          requestOptions,
        ),
      vcsApply: (input: TopLevelVcsApplyInput, requestOptions?: RequestOptions) =>
        request<TopLevelVcsApplyOutput>(
          {
            method: "POST",
            path: `/vcs/apply`,
            body: { patch: input["patch"] },
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      command: (requestOptions?: RequestOptions) =>
        request<TopLevelCommandOutput>(
          { method: "GET", path: `/command`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      agent: (requestOptions?: RequestOptions) =>
        request<TopLevelAgentOutput>(
          { method: "GET", path: `/agent`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      skill: (requestOptions?: RequestOptions) =>
        request<TopLevelSkillOutput>(
          { method: "GET", path: `/skill`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      lsp: (requestOptions?: RequestOptions) =>
        request<TopLevelLspOutput>(
          { method: "GET", path: `/lsp`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      formatter: (requestOptions?: RequestOptions) =>
        request<TopLevelFormatterOutput>(
          { method: "GET", path: `/formatter`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    analytics: {
      global: (requestOptions?: RequestOptions) =>
        request<AnalyticsGlobalOutput>(
          { method: "GET", path: `/analytics/global`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      daily: (input?: AnalyticsDailyInput, requestOptions?: RequestOptions) =>
        request<AnalyticsDailyOutput>(
          {
            method: "GET",
            path: `/analytics/daily`,
            query: { from: input?.["from"], to: input?.["to"], days: input?.["days"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      session: (input: AnalyticsSessionInput, requestOptions?: RequestOptions) =>
        request<AnalyticsSessionOutput>(
          {
            method: "GET",
            path: `/analytics/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      sessions: (requestOptions?: RequestOptions) =>
        request<AnalyticsSessionsOutput>(
          { method: "GET", path: `/analytics/sessions`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      leaderboard: (requestOptions?: RequestOptions) =>
        request<AnalyticsLeaderboardOutput>(
          { method: "GET", path: `/analytics/leaderboard`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    app: {
      log: (input: AppLogInput, requestOptions?: RequestOptions) =>
        request<AppLogOutput>(
          {
            method: "POST",
            path: `/log`,
            body: {
              service: input["service"],
              level: input["level"],
              message: input["message"],
              extra: input["extra"],
            },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      skillCreate: (input: AppSkillCreateInput, requestOptions?: RequestOptions) =>
        request<AppSkillCreateOutput>(
          {
            method: "POST",
            path: `/skill`,
            body: {
              name: input["name"],
              description: input["description"],
              category: input["category"],
              tags: input["tags"],
              content: input["content"],
              scope: input["scope"],
            },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      skillDelete: (input: AppSkillDeleteInput, requestOptions?: RequestOptions) =>
        request<AppSkillDeleteOutput>(
          {
            method: "DELETE",
            path: `/skill/${encodeURIComponent(input.name)}`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    brain: {
      status: (requestOptions?: RequestOptions) =>
        request<BrainStatusOutput>(
          { method: "GET", path: `/brain`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      trigger: (input?: BrainTriggerInput, requestOptions?: RequestOptions) =>
        request<BrainTriggerOutput>(
          {
            method: "POST",
            path: `/brain/trigger`,
            body: { force: input?.["force"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    config: {
      get: (requestOptions?: RequestOptions) =>
        request<ConfigGetOutput>(
          { method: "GET", path: `/config`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      update: (input: ConfigUpdateInput, requestOptions?: RequestOptions) =>
        request<ConfigUpdateOutput>(
          {
            method: "PATCH",
            path: `/config`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      providers: (requestOptions?: RequestOptions) =>
        request<ConfigProvidersOutput>(
          { method: "GET", path: `/config/providers`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    connectors: {
      status: (requestOptions?: RequestOptions) =>
        request<ConnectorsStatusOutput>(
          { method: "GET", path: `/connectors`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      authSet: (input: ConnectorsAuthSetInput, requestOptions?: RequestOptions) =>
        request<ConnectorsAuthSetOutput>(
          {
            method: "POST",
            path: `/connectors/${encodeURIComponent(input.name)}/auth`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      authRemove: (input: ConnectorsAuthRemoveInput, requestOptions?: RequestOptions) =>
        request<ConnectorsAuthRemoveOutput>(
          {
            method: "DELETE",
            path: `/connectors/${encodeURIComponent(input.name)}/auth`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      invalidate: (input?: ConnectorsInvalidateInput, requestOptions?: RequestOptions) =>
        request<ConnectorsInvalidateOutput>(
          {
            method: "POST",
            path: `/connectors/invalidate`,
            body: { name: input?.["name"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    doctor: {
      run: (requestOptions?: RequestOptions) =>
        request<DoctorRunOutput>(
          { method: "GET", path: `/doctor`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    experimental: {
      toolIDs: (requestOptions?: RequestOptions) =>
        request<ExperimentalToolIDsOutput>(
          { method: "GET", path: `/experimental/tool/ids`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      tools: (input: ExperimentalToolsInput, requestOptions?: RequestOptions) =>
        request<ExperimentalToolsOutput>(
          {
            method: "GET",
            path: `/experimental/tool`,
            query: { provider: input["provider"], model: input["model"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      worktreeCreate: (input?: ExperimentalWorktreeCreateInput, requestOptions?: RequestOptions) =>
        request<ExperimentalWorktreeCreateOutput>(
          {
            method: "POST",
            path: `/experimental/worktree`,
            body: {
              name: input?.["name"],
              branch: input?.["branch"],
              branchPrefix: input?.["branchPrefix"],
              baseBranch: input?.["baseBranch"],
              remote: input?.["remote"],
              startCommand: input?.["startCommand"],
            },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      worktree: (requestOptions?: RequestOptions) =>
        request<ExperimentalWorktreeOutput>(
          { method: "GET", path: `/experimental/worktree`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      worktreeRemove: (input: ExperimentalWorktreeRemoveInput, requestOptions?: RequestOptions) =>
        request<ExperimentalWorktreeRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/worktree`,
            body: { directory: input["directory"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      worktreeReset: (input: ExperimentalWorktreeResetInput, requestOptions?: RequestOptions) =>
        request<ExperimentalWorktreeResetOutput>(
          {
            method: "POST",
            path: `/experimental/worktree/reset`,
            body: { directory: input["directory"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      resource: (requestOptions?: RequestOptions) =>
        request<ExperimentalResourceOutput>(
          { method: "GET", path: `/experimental/resource`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      managedWorktreeCreate: (input: ExperimentalManagedWorktreeCreateInput, requestOptions?: RequestOptions) =>
        request<ExperimentalManagedWorktreeCreateOutput>(
          {
            method: "POST",
            path: `/experimental/managed-worktree`,
            body: { from: input["from"], name: input["name"], into: input["into"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      managedWorktreeRemove: (input: ExperimentalManagedWorktreeRemoveInput, requestOptions?: RequestOptions) =>
        request<ExperimentalManagedWorktreeRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/managed-worktree`,
            body: { at: input["at"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      managedWorktreeLink: (input: ExperimentalManagedWorktreeLinkInput, requestOptions?: RequestOptions) =>
        request<ExperimentalManagedWorktreeLinkOutput>(
          {
            method: "POST",
            path: `/experimental/managed-worktree/link`,
            body: { at: input["at"], to: input["to"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      managedWorktreeChildren: (input: ExperimentalManagedWorktreeChildrenInput, requestOptions?: RequestOptions) =>
        request<ExperimentalManagedWorktreeChildrenOutput>(
          {
            method: "GET",
            path: `/experimental/managed-worktree/children`,
            query: { of: input["of"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      managedWorktreeAncestors: (input: ExperimentalManagedWorktreeAncestorsInput, requestOptions?: RequestOptions) =>
        request<ExperimentalManagedWorktreeAncestorsOutput>(
          {
            method: "GET",
            path: `/experimental/managed-worktree/ancestors`,
            query: { of: input["of"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      managedWorktreeList: (requestOptions?: RequestOptions) =>
        request<ExperimentalManagedWorktreeListOutput>(
          {
            method: "GET",
            path: `/experimental/managed-worktree`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    file: {
      findText: (input: FileFindTextInput, requestOptions?: RequestOptions) =>
        request<FileFindTextOutput>(
          {
            method: "GET",
            path: `/find`,
            query: { pattern: input["pattern"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      findFile: (input: FileFindFileInput, requestOptions?: RequestOptions) =>
        request<FileFindFileOutput>(
          {
            method: "GET",
            path: `/find/file`,
            query: { query: input["query"], dirs: input["dirs"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      findSymbol: (input: FileFindSymbolInput, requestOptions?: RequestOptions) =>
        request<FileFindSymbolOutput>(
          {
            method: "GET",
            path: `/find/symbol`,
            query: { query: input["query"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: FileListInput, requestOptions?: RequestOptions) =>
        request<FileListOutput>(
          {
            method: "GET",
            path: `/file`,
            query: { path: input["path"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      content: (input: FileContentInput, requestOptions?: RequestOptions) =>
        request<FileContentOutput>(
          {
            method: "GET",
            path: `/file/content`,
            query: { path: input["path"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      write: (input: FileWriteInput, requestOptions?: RequestOptions) =>
        request<FileWriteOutput>(
          {
            method: "PUT",
            path: `/file/content`,
            body: { path: input["path"], content: input["content"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      status: (requestOptions?: RequestOptions) =>
        request<FileStatusOutput>(
          { method: "GET", path: `/file/status`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    global: {
      health: (requestOptions?: RequestOptions) =>
        request<GlobalHealthOutput>(
          { method: "GET", path: `/global/health`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      dispose: (requestOptions?: RequestOptions) =>
        request<GlobalDisposeOutput>(
          { method: "POST", path: `/global/dispose`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    mcp: {
      status: (requestOptions?: RequestOptions) =>
        request<McpStatusOutput>(
          { method: "GET", path: `/mcp`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      add: (input: McpAddInput, requestOptions?: RequestOptions) =>
        request<McpAddOutput>(
          {
            method: "POST",
            path: `/mcp`,
            body: { name: input["name"], config: input["config"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      startAuth: (input: McpStartAuthInput, requestOptions?: RequestOptions) =>
        request<McpStartAuthOutput>(
          {
            method: "POST",
            path: `/mcp/${encodeURIComponent(input.name)}/auth`,
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      authCallback: (input: McpAuthCallbackInput, requestOptions?: RequestOptions) =>
        request<McpAuthCallbackOutput>(
          {
            method: "POST",
            path: `/mcp/${encodeURIComponent(input.name)}/auth/callback`,
            body: { code: input["code"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      authenticate: (input: McpAuthenticateInput, requestOptions?: RequestOptions) =>
        request<McpAuthenticateOutput>(
          {
            method: "POST",
            path: `/mcp/${encodeURIComponent(input.name)}/auth/authenticate`,
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      removeAuth: (input: McpRemoveAuthInput, requestOptions?: RequestOptions) =>
        request<McpRemoveAuthOutput>(
          {
            method: "DELETE",
            path: `/mcp/${encodeURIComponent(input.name)}/auth`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      connect: (input: McpConnectInput, requestOptions?: RequestOptions) =>
        request<McpConnectOutput>(
          {
            method: "POST",
            path: `/mcp/${encodeURIComponent(input.name)}/connect`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      disconnect: (input: McpDisconnectInput, requestOptions?: RequestOptions) =>
        request<McpDisconnectOutput>(
          {
            method: "POST",
            path: `/mcp/${encodeURIComponent(input.name)}/disconnect`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      toggle: (input: McpToggleInput, requestOptions?: RequestOptions) =>
        request<McpToggleOutput>(
          {
            method: "POST",
            path: `/mcp/${encodeURIComponent(input.name)}/toggle`,
            body: { enabled: input["enabled"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    mission: {
      list: (requestOptions?: RequestOptions) =>
        request<MissionListOutput>(
          { method: "GET", path: `/mission`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      templates: (requestOptions?: RequestOptions) =>
        request<MissionTemplatesOutput>(
          { method: "GET", path: `/mission/templates`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      generate: (input: MissionGenerateInput, requestOptions?: RequestOptions) =>
        request<MissionGenerateOutput>(
          {
            method: "POST",
            path: `/mission/generate`,
            body: { description: input["description"], model: input["model"], agent: input["agent"] },
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      recentExecs: (input?: MissionRecentExecsInput, requestOptions?: RequestOptions) =>
        request<MissionRecentExecsOutput>(
          {
            method: "GET",
            path: `/mission/execs/recent`,
            query: { limit: input?.["limit"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: MissionGetInput, requestOptions?: RequestOptions) =>
        request<MissionGetOutput>(
          {
            method: "GET",
            path: `/mission/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      upsert: (input: MissionUpsertInput, requestOptions?: RequestOptions) =>
        request<MissionUpsertOutput>(
          {
            method: "PUT",
            path: `/mission`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: MissionUpdateInput, requestOptions?: RequestOptions) =>
        request<MissionUpdateOutput>(
          {
            method: "POST",
            path: `/mission/${encodeURIComponent(input.id)}`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [404, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: MissionRemoveInput, requestOptions?: RequestOptions) =>
        request<MissionRemoveOutput>(
          {
            method: "DELETE",
            path: `/mission/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      start: (input: MissionStartInput, requestOptions?: RequestOptions) =>
        request<MissionStartOutput>(
          {
            method: "POST",
            path: `/mission/${encodeURIComponent(input.id)}/start`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      pause: (input: MissionPauseInput, requestOptions?: RequestOptions) =>
        request<MissionPauseOutput>(
          {
            method: "POST",
            path: `/mission/${encodeURIComponent(input.id)}/pause`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      cancel: (input: MissionCancelInput, requestOptions?: RequestOptions) =>
        request<MissionCancelOutput>(
          {
            method: "POST",
            path: `/mission/${encodeURIComponent(input.id)}/cancel`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      featureMutate: (input: MissionFeatureMutateInput, requestOptions?: RequestOptions) =>
        request<MissionFeatureMutateOutput>(
          {
            method: "POST",
            path: `/mission/${encodeURIComponent(input.id)}/feature/${encodeURIComponent(input.featureID)}`,
            body: { status: input["status"], error: input["error"], appendDependsOn: input["appendDependsOn"] },
            successStatus: 200,
            declaredStatuses: [404, 400],
            empty: false,
          },
          requestOptions,
        ),
      execs: (input: MissionExecsInput, requestOptions?: RequestOptions) =>
        request<MissionExecsOutput>(
          {
            method: "GET",
            path: `/mission/${encodeURIComponent(input.id)}/execs`,
            query: { limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    project: {
      list: (requestOptions?: RequestOptions) =>
        request<ProjectListOutput>(
          { method: "GET", path: `/project`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      current: (requestOptions?: RequestOptions) =>
        request<ProjectCurrentOutput>(
          { method: "GET", path: `/project/current`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      update: (input: ProjectUpdateInput, requestOptions?: RequestOptions) =>
        request<ProjectUpdateOutput>(
          {
            method: "PATCH",
            path: `/project/${encodeURIComponent(input.projectID)}`,
            body: { name: input["name"], icon: input["icon"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    provider: {
      list: (requestOptions?: RequestOptions) =>
        request<ProviderListOutput>(
          { method: "GET", path: `/provider`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      auth: (requestOptions?: RequestOptions) =>
        request<ProviderAuthOutput>(
          { method: "GET", path: `/provider/auth`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      api: (input: ProviderApiInput, requestOptions?: RequestOptions) =>
        request<ProviderApiOutput>(
          {
            method: "POST",
            path: `/provider/${encodeURIComponent(input.providerID)}/api`,
            body: { key: input["key"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      removeAuth: (input: ProviderRemoveAuthInput, requestOptions?: RequestOptions) =>
        request<ProviderRemoveAuthOutput>(
          {
            method: "DELETE",
            path: `/provider/${encodeURIComponent(input.providerID)}/auth`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      oauthAuthorize: (input: ProviderOauthAuthorizeInput, requestOptions?: RequestOptions) =>
        request<ProviderOauthAuthorizeOutput>(
          {
            method: "POST",
            path: `/provider/${encodeURIComponent(input.providerID)}/oauth/authorize`,
            body: { method: input["method"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      oauthCallback: (input: ProviderOauthCallbackInput, requestOptions?: RequestOptions) =>
        request<ProviderOauthCallbackOutput>(
          {
            method: "POST",
            path: `/provider/${encodeURIComponent(input.providerID)}/oauth/callback`,
            body: { method: input["method"], code: input["code"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    question: {
      list: (requestOptions?: RequestOptions) =>
        request<QuestionListOutput>(
          { method: "GET", path: `/question`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      reply: (input: QuestionReplyInput, requestOptions?: RequestOptions) =>
        request<QuestionReplyOutput>(
          {
            method: "POST",
            path: `/question/${encodeURIComponent(input.requestID)}/reply`,
            body: { answers: input["answers"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      reject: (input: QuestionRejectInput, requestOptions?: RequestOptions) =>
        request<QuestionRejectOutput>(
          {
            method: "POST",
            path: `/question/${encodeURIComponent(input.requestID)}/reject`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    permission: {
      list: (requestOptions?: RequestOptions) =>
        request<PermissionListOutput>(
          { method: "GET", path: `/permission`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      reply: (input: PermissionReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionReplyOutput>(
          {
            method: "POST",
            path: `/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { reply: input["reply"], message: input["message"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    pty: {
      list: (requestOptions?: RequestOptions) =>
        request<PtyListOutput>(
          { method: "GET", path: `/pty`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      create: (input?: PtyCreateInput, requestOptions?: RequestOptions) =>
        request<PtyCreateOutput>(
          {
            method: "POST",
            path: `/pty`,
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtyGetInput, requestOptions?: RequestOptions) =>
        request<PtyGetOutput>(
          {
            method: "GET",
            path: `/pty/${encodeURIComponent(input.ptyID)}`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtyUpdateInput, requestOptions?: RequestOptions) =>
        request<PtyUpdateOutput>(
          {
            method: "PUT",
            path: `/pty/${encodeURIComponent(input.ptyID)}`,
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtyRemoveInput, requestOptions?: RequestOptions) =>
        request<PtyRemoveOutput>(
          {
            method: "DELETE",
            path: `/pty/${encodeURIComponent(input.ptyID)}`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    loop: {
      list: (requestOptions?: RequestOptions) =>
        request<LoopListOutput>(
          { method: "GET", path: `/loop`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      templates: (requestOptions?: RequestOptions) =>
        request<LoopTemplatesOutput>(
          { method: "GET", path: `/loop/templates`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      generate: (input: LoopGenerateInput, requestOptions?: RequestOptions) =>
        request<LoopGenerateOutput>(
          {
            method: "POST",
            path: `/loop/generate`,
            body: { description: input["description"], model: input["model"], agent: input["agent"] },
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      recentRuns: (input?: LoopRecentRunsInput, requestOptions?: RequestOptions) =>
        request<LoopRecentRunsOutput>(
          {
            method: "GET",
            path: `/loop/runs/recent`,
            query: { limit: input?.["limit"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: LoopGetInput, requestOptions?: RequestOptions) =>
        request<LoopGetOutput>(
          {
            method: "GET",
            path: `/loop/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      upsert: (input: LoopUpsertInput, requestOptions?: RequestOptions) =>
        request<LoopUpsertOutput>(
          {
            method: "PUT",
            path: `/loop`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: LoopUpdateInput, requestOptions?: RequestOptions) =>
        request<LoopUpdateOutput>(
          {
            method: "POST",
            path: `/loop/${encodeURIComponent(input.id)}`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [404, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: LoopRemoveInput, requestOptions?: RequestOptions) =>
        request<LoopRemoveOutput>(
          {
            method: "DELETE",
            path: `/loop/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      toggle: (input: LoopToggleInput, requestOptions?: RequestOptions) =>
        request<LoopToggleOutput>(
          {
            method: "POST",
            path: `/loop/${encodeURIComponent(input.id)}/toggle`,
            body: { enabled: input["enabled"] },
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      run: (input: LoopRunInput, requestOptions?: RequestOptions) =>
        request<LoopRunOutput>(
          {
            method: "POST",
            path: `/loop/${encodeURIComponent(input.id)}/run`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      abort: (input: LoopAbortInput, requestOptions?: RequestOptions) =>
        request<LoopAbortOutput>(
          {
            method: "POST",
            path: `/loop/${encodeURIComponent(input.id)}/abort`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      pause: (input: LoopPauseInput, requestOptions?: RequestOptions) =>
        request<LoopPauseOutput>(
          {
            method: "POST",
            path: `/loop/${encodeURIComponent(input.id)}/pause`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      resume: (input: LoopResumeInput, requestOptions?: RequestOptions) =>
        request<LoopResumeOutput>(
          {
            method: "POST",
            path: `/loop/${encodeURIComponent(input.id)}/resume`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      runs: (input: LoopRunsInput, requestOptions?: RequestOptions) =>
        request<LoopRunsOutput>(
          {
            method: "GET",
            path: `/loop/${encodeURIComponent(input.id)}/runs`,
            query: { limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    session: {
      list: (input?: SessionListInput, requestOptions?: RequestOptions) =>
        request<SessionListOutput>(
          {
            method: "GET",
            path: `/session`,
            query: {
              directory: input?.["directory"],
              roots: input?.["roots"],
              start: input?.["start"],
              search: input?.["search"],
              limit: input?.["limit"],
            },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: SessionCreateInput, requestOptions?: RequestOptions) =>
        request<SessionCreateOutput>(
          {
            method: "POST",
            path: `/session`,
            body: {
              parentID: input?.["parentID"],
              title: input?.["title"],
              permission: input?.["permission"],
              skills: input?.["skills"],
              github: input?.["github"],
              workspaceID: input?.["workspaceID"],
            },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      status: (requestOptions?: RequestOptions) =>
        request<SessionStatusOutput>(
          { method: "GET", path: `/session/status`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      get: (input: SessionGetInput, requestOptions?: RequestOptions) =>
        request<SessionGetOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: SessionRemoveInput, requestOptions?: RequestOptions) =>
        request<SessionRemoveOutput>(
          {
            method: "DELETE",
            path: `/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: SessionUpdateInput, requestOptions?: RequestOptions) =>
        request<SessionUpdateOutput>(
          {
            method: "PATCH",
            path: `/session/${encodeURIComponent(input.sessionID)}`,
            body: { title: input["title"], time: input["time"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      fork: (input: SessionForkInput, requestOptions?: RequestOptions) =>
        request<SessionForkOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/fork`,
            body: { messageID: input["messageID"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      abort: (input: SessionAbortInput, requestOptions?: RequestOptions) =>
        request<SessionAbortOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/abort`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      revert: (input: SessionRevertInput, requestOptions?: RequestOptions) =>
        request<SessionRevertOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/revert`,
            body: { messageID: input["messageID"], partID: input["partID"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      unrevert: (input: SessionUnrevertInput, requestOptions?: RequestOptions) =>
        request<SessionUnrevertOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/unrevert`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      share: (input: SessionShareInput, requestOptions?: RequestOptions) =>
        request<SessionShareOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/share`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      unshare: (input: SessionUnshareInput, requestOptions?: RequestOptions) =>
        request<SessionUnshareOutput>(
          {
            method: "DELETE",
            path: `/session/${encodeURIComponent(input.sessionID)}/share`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      summarize: (input: SessionSummarizeInput, requestOptions?: RequestOptions) =>
        request<SessionSummarizeOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/summarize`,
            body: { providerID: input["providerID"], modelID: input["modelID"], auto: input["auto"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      command: (input: SessionCommandInput, requestOptions?: RequestOptions) =>
        request<SessionCommandOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/command`,
            body: {
              messageID: input["messageID"],
              agent: input["agent"],
              model: input["model"],
              arguments: input["arguments"],
              command: input["command"],
              variant: input["variant"],
              parts: input["parts"],
            },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      shell: (input: SessionShellInput, requestOptions?: RequestOptions) =>
        request<SessionShellOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/shell`,
            body: { agent: input["agent"], model: input["model"], command: input["command"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      permissionRespond: (input: SessionPermissionRespondInput, requestOptions?: RequestOptions) =>
        request<SessionPermissionRespondOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/permissions/${encodeURIComponent(input.permissionID)}`,
            body: { response: input["response"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      children: (input: SessionChildrenInput, requestOptions?: RequestOptions) =>
        request<SessionChildrenOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/children`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      todo: (input: SessionTodoInput, requestOptions?: RequestOptions) =>
        request<SessionTodoOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/todo`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      diff: (input: SessionDiffInput, requestOptions?: RequestOptions) =>
        request<SessionDiffOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/diff`,
            query: { messageID: input["messageID"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      messages: (input: SessionMessagesInput, requestOptions?: RequestOptions) =>
        request<SessionMessagesOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      message: (input: SessionMessageInput, requestOptions?: RequestOptions) =>
        request<SessionMessageOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      messageRemove: (input: SessionMessageRemoveInput, requestOptions?: RequestOptions) =>
        request<SessionMessageRemoveOutput>(
          {
            method: "DELETE",
            path: `/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      partRemove: (input: SessionPartRemoveInput, requestOptions?: RequestOptions) =>
        request<SessionPartRemoveOutput>(
          {
            method: "DELETE",
            path: `/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}/part/${encodeURIComponent(input.partID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      partUpdate: (input: SessionPartUpdateInput, requestOptions?: RequestOptions) =>
        request<SessionPartUpdateOutput>(
          {
            method: "PATCH",
            path: `/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}/part/${encodeURIComponent(input.partID)}`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      v2Entries: (input: SessionV2EntriesInput, requestOptions?: RequestOptions) =>
        request<SessionV2EntriesOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/v2/entries`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      v2State: (input: SessionV2StateInput, requestOptions?: RequestOptions) =>
        request<SessionV2StateOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/v2/state`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      v2Events: (input: SessionV2EventsInput, requestOptions?: RequestOptions) =>
        request<SessionV2EventsOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/v2/events`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      instructions: (input: SessionInstructionsInput, requestOptions?: RequestOptions) =>
        request<SessionInstructionsOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/instructions`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      contextBreakdown: (input: SessionContextBreakdownInput, requestOptions?: RequestOptions) =>
        request<SessionContextBreakdownOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      contextToggle: (input: SessionContextToggleInput, requestOptions?: RequestOptions) =>
        request<SessionContextToggleOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/context/toggle`,
            body: { kind: input["kind"], key: input["key"], enabled: input["enabled"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      goal: (input: SessionGoalInput, requestOptions?: RequestOptions) =>
        request<SessionGoalOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/goal`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      background: (input: SessionBackgroundInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/background`,
            successStatus: 200,
            declaredStatuses: [404],
            empty: false,
          },
          requestOptions,
        ),
      backgroundInspect: (input: SessionBackgroundInspectInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundInspectOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/background/${encodeURIComponent(input.delegationID)}`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      backgroundRead: (input: SessionBackgroundReadInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundReadOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/background/${encodeURIComponent(input.delegationID)}/read`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      backgroundCancel: (input: SessionBackgroundCancelInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundCancelOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/background/${encodeURIComponent(input.delegationID)}/cancel`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      monitor: (input: SessionMonitorInput, requestOptions?: RequestOptions) =>
        request<SessionMonitorOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/monitor/${encodeURIComponent(input.monitorID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      monitorLog: (input: SessionMonitorLogInput, requestOptions?: RequestOptions) =>
        request<SessionMonitorLogOutput>(
          {
            method: "GET",
            path: `/session/${encodeURIComponent(input.sessionID)}/monitor/${encodeURIComponent(input.monitorID)}/log`,
            query: { lines: input["lines"] },
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
      monitorCancel: (input: SessionMonitorCancelInput, requestOptions?: RequestOptions) =>
        request<SessionMonitorCancelOutput>(
          {
            method: "POST",
            path: `/session/${encodeURIComponent(input.sessionID)}/monitor/${encodeURIComponent(input.monitorID)}/cancel`,
            successStatus: 200,
            declaredStatuses: [404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    sync: {
      start: (input: SyncStartInput, requestOptions?: RequestOptions) =>
        request<SyncStartOutput>(
          {
            method: "POST",
            path: `/sync/start`,
            body: { url: input["url"], token: input["token"], projectID: input["projectID"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      replay: (input: SyncReplayInput, requestOptions?: RequestOptions) =>
        request<SyncReplayOutput>(
          {
            method: "POST",
            path: `/sync/replay`,
            body: {
              projectID: input["projectID"],
              aggregate: input["aggregate"],
              data: input["data"],
              origin: input["origin"],
            },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      history: (input: SyncHistoryInput, requestOptions?: RequestOptions) =>
        request<SyncHistoryOutput>(
          {
            method: "GET",
            path: `/sync/history`,
            query: {
              projectID: input["projectID"],
              aggregate: input["aggregate"],
              since: input["since"],
              limit: input["limit"],
            },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      snapshot: (input: SyncSnapshotInput, requestOptions?: RequestOptions) =>
        request<SyncSnapshotOutput>(
          {
            method: "GET",
            path: `/sync/snapshot`,
            query: { projectID: input["projectID"], aggregate: input["aggregate"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    tui: {
      appendPrompt: (input: TuiAppendPromptInput, requestOptions?: RequestOptions) =>
        request<TuiAppendPromptOutput>(
          {
            method: "POST",
            path: `/tui/append-prompt`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      openHelp: (requestOptions?: RequestOptions) =>
        request<TuiOpenHelpOutput>(
          { method: "POST", path: `/tui/open-help`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      openSessions: (requestOptions?: RequestOptions) =>
        request<TuiOpenSessionsOutput>(
          { method: "POST", path: `/tui/open-sessions`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      openThemes: (requestOptions?: RequestOptions) =>
        request<TuiOpenThemesOutput>(
          { method: "POST", path: `/tui/open-themes`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      openModels: (requestOptions?: RequestOptions) =>
        request<TuiOpenModelsOutput>(
          { method: "POST", path: `/tui/open-models`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      submitPrompt: (requestOptions?: RequestOptions) =>
        request<TuiSubmitPromptOutput>(
          { method: "POST", path: `/tui/submit-prompt`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      clearPrompt: (requestOptions?: RequestOptions) =>
        request<TuiClearPromptOutput>(
          { method: "POST", path: `/tui/clear-prompt`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      executeCommand: (input: TuiExecuteCommandInput, requestOptions?: RequestOptions) =>
        request<TuiExecuteCommandOutput>(
          {
            method: "POST",
            path: `/tui/execute-command`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      showToast: (input: TuiShowToastInput, requestOptions?: RequestOptions) =>
        request<TuiShowToastOutput>(
          {
            method: "POST",
            path: `/tui/show-toast`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      publish: (input: TuiPublishInput, requestOptions?: RequestOptions) =>
        request<TuiPublishOutput>(
          {
            method: "POST",
            path: `/tui/publish`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400],
            empty: false,
          },
          requestOptions,
        ),
      selectSession: (input: TuiSelectSessionInput, requestOptions?: RequestOptions) =>
        request<TuiSelectSessionOutput>(
          {
            method: "POST",
            path: `/tui/select-session`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400, 404],
            empty: false,
          },
          requestOptions,
        ),
      controlNext: (requestOptions?: RequestOptions) =>
        request<TuiControlNextOutput>(
          { method: "GET", path: `/tui/control/next`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      controlResponse: (input: TuiControlResponseInput, requestOptions?: RequestOptions) =>
        request<TuiControlResponseOutput>(
          {
            method: "POST",
            path: `/tui/control/response`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    workspace: {
      adaptors: (requestOptions?: RequestOptions) =>
        request<WorkspaceAdaptorsOutput>(
          {
            method: "GET",
            path: `/experimental/workspace/adaptor`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      syncList: (requestOptions?: RequestOptions) =>
        request<WorkspaceSyncListOutput>(
          {
            method: "POST",
            path: `/experimental/workspace/sync-list`,
            successStatus: 204,
            declaredStatuses: [],
            empty: true,
          },
          requestOptions,
        ),
      status: (requestOptions?: RequestOptions) =>
        request<WorkspaceStatusOutput>(
          {
            method: "GET",
            path: `/experimental/workspace/status`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: WorkspaceCreateInput, requestOptions?: RequestOptions) =>
        request<WorkspaceCreateOutput>(
          {
            method: "POST",
            path: `/experimental/workspace/${encodeURIComponent(input.id)}`,
            body: { branch: input["branch"], config: input["config"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      list: (requestOptions?: RequestOptions) =>
        request<WorkspaceListOutput>(
          { method: "GET", path: `/experimental/workspace`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
      remove: (input: WorkspaceRemoveInput, requestOptions?: RequestOptions) =>
        request<WorkspaceRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/workspace/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      restore: (input: WorkspaceRestoreInput, requestOptions?: RequestOptions) =>
        request<WorkspaceRestoreOutput>(
          {
            method: "POST",
            path: `/experimental/workspace/${encodeURIComponent(input.id)}/restore`,
            query: { timeoutMs: input["timeoutMs"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      sessionRestore: (input: WorkspaceSessionRestoreInput, requestOptions?: RequestOptions) =>
        request<WorkspaceSessionRestoreOutput>(
          {
            method: "POST",
            path: `/experimental/workspace/${encodeURIComponent(input.id)}/session/${encodeURIComponent(input.sessionID)}/restore`,
            query: { timeoutMs: input["timeoutMs"] },
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
      warp: (input: WorkspaceWarpInput, requestOptions?: RequestOptions) =>
        request<WorkspaceWarpOutput>(
          {
            method: "POST",
            path: `/experimental/workspace/warp`,
            body: {
              id: input["id"],
              sessionID: input["sessionID"],
              copyChanges: input["copyChanges"],
              timeoutMs: input["timeoutMs"],
            },
            successStatus: 204,
            declaredStatuses: [],
            empty: true,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return
  if (value === null) {
    params.append(key, "null")
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
