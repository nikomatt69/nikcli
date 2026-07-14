import type {
  Agent,
  Command,
  ConnectorStatus,
  Event,
  McpResource,
  McpStatus,
  Message,
  Model,
  NikcliClient,
  Part,
  PermissionRequest,
  PermissionRule,
  Provider,
  Pty,
  QuestionRequest,
  ReferenceConfig,
  Session,
  SessionEntryAssistantReasoning,
  SessionEntryAssistantRetry,
  SessionEntryAssistantText,
  SessionEntryAssistantTool,
  SessionEntrySynthetic,
  SessionEntryUser,
} from "@nikcli-ai/sdk/v2"
import type { JSX } from "@opentui/solid"

export type LocationRef = {
  readonly directory: string
  readonly workspaceID?: string
}

export type SessionInfo = Session
export type SessionPendingInfo =
  | SessionEntryUser
  | SessionEntrySynthetic
  | SessionEntryAssistantText
  | SessionEntryAssistantReasoning
  | SessionEntryAssistantTool
  | SessionEntryAssistantRetry
export type SessionMessageInfo = { readonly info: Message; readonly parts: Part[] }
export type PermissionV2Request = PermissionRequest
export type FormInfo = QuestionRequest
export type PermissionSavedInfo = PermissionRule
export type ShellInfo = Pty
export type AgentInfo = Agent
export type CommandInfo = Command
export type IntegrationInfo = { readonly name: string; readonly status: ConnectorStatus }
export type McpServer = { readonly name: string; readonly status: McpStatus }
export type ModelInfo = Model
export type ProviderV2Info = Provider
export type ReferenceInfo = ReferenceConfig & { readonly name: string }
export type SkillInfo = {
  readonly name: string
  readonly description: string
  readonly location: string
  readonly category?: string
  readonly tags?: string[]
  readonly version?: string
}

interface LocationCollection<Value> {
  list(location?: LocationRef): Value[] | undefined
  refresh(location?: LocationRef): Promise<void>
}

/** Reactive nikcli data exposed to a v2 TUI plugin. */
export interface Data {
  readonly on: <Type extends Event["type"]>(
    type: Type,
    handler: (event: Extract<Event, { type: Type }>) => void,
  ) => () => void
  readonly listen: (handler: (event: { details: Event }) => void) => () => void
  readonly session: {
    list(): SessionInfo[]
    get(sessionID: string): SessionInfo | undefined
    root(sessionID: string): string
    family(sessionID: string): string[]
    cost(sessionID: string): number
    status(sessionID: string): "idle" | "running"
    readonly pending: {
      list(sessionID: string): SessionPendingInfo[]
      refresh(sessionID: string): Promise<void>
    }
    refresh(sessionID: string): Promise<void>
    readonly message: {
      list(sessionID: string): SessionMessageInfo[]
      get(sessionID: string, messageID: string): SessionMessageInfo | undefined
      refresh(sessionID: string): Promise<void>
    }
    readonly permission: {
      list(sessionID: string): PermissionV2Request[] | undefined
      refresh(sessionID: string): Promise<void>
    }
    readonly form: {
      list(sessionID: string, location?: LocationRef): Array<FormInfo & { readonly location?: LocationRef }> | undefined
      refresh(sessionID: string, location?: LocationRef): Promise<void>
    }
  }
  readonly project: {
    readonly permission: {
      list(projectID: string): PermissionSavedInfo[] | undefined
      refresh(projectID: string): Promise<void>
    }
  }
  readonly shell: {
    list(location?: LocationRef): ShellInfo[]
    get(id: string): ShellInfo | undefined
    refresh(location?: LocationRef): Promise<void>
  }
  readonly location: {
    default(): LocationRef
    refresh(location?: LocationRef): Promise<void>
    readonly agent: LocationCollection<AgentInfo>
    readonly command: LocationCollection<CommandInfo>
    readonly integration: LocationCollection<IntegrationInfo>
    readonly mcp: {
      readonly server: LocationCollection<McpServer>
      readonly resource: LocationCollection<McpResource>
    }
    readonly model: LocationCollection<ModelInfo>
    readonly provider: LocationCollection<ProviderV2Info>
    readonly reference: LocationCollection<ReferenceInfo>
    readonly skill: LocationCollection<SkillInfo>
  }
}

export type Route =
  | { readonly type: "home" }
  | { readonly type: "session"; readonly sessionID: string }
  | {
      readonly type: "plugin"
      readonly id: string
      readonly name: string
      readonly data?: Record<string, unknown>
    }

export type Destination = Route | Omit<Extract<Route, { readonly type: "plugin" }>, "id">

export interface Page {
  readonly name: string
  readonly render: (input: { readonly data?: Record<string, unknown> }) => JSX.Element
}

export type Slot = (props: Record<string, unknown>) => JSX.Element

export interface UI {
  readonly router: {
    register(page: Page): () => void
    navigate(destination: Destination): void
    current(): Route
  }
  readonly slot: (name: string, render: Slot) => () => void
}

export interface Context {
  readonly options: Readonly<Record<string, unknown>>
  readonly client: NikcliClient
  readonly data: Data
  readonly ui: UI
}
