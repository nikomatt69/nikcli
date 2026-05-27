import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Format } from "@/format"
import { Global } from "@/global"
import { InstanceState } from "@/effect"
import { Instance } from "@/project/instance"
import { LSP } from "@/lsp"
import { Skill } from "@/skill"
import { Vcs } from "@/project/vcs"

export namespace TopLevelHttpApi {
  export const Path = Schema.Struct({
    home: Schema.String,
    state: Schema.String,
    config: Schema.String,
    worktree: Schema.String,
    directory: Schema.String,
  }).annotate({ identifier: "Path" })

  export const VcsInfo = Schema.Struct({
    branch: Schema.optional(Schema.String),
  }).annotate({ identifier: "VcsInfo" })

  export const CommandInfo = Schema.Struct({
    name: Schema.String,
    description: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    mcp: Schema.optional(Schema.Boolean),
    skill: Schema.optional(Schema.Boolean),
    template: Schema.Unknown,
    subtask: Schema.optional(Schema.Boolean),
    hints: Schema.Array(Schema.String),
  }).annotate({ identifier: "Command" })

  const ModelRef = Schema.Struct({
    modelID: Schema.String,
    providerID: Schema.String,
  })

  export const AgentInfo = Schema.Struct({
    name: Schema.String,
    description: Schema.optional(Schema.String),
    mode: Schema.Literals(["subagent", "primary", "all"]),
    native: Schema.optional(Schema.Boolean),
    hidden: Schema.optional(Schema.Boolean),
    topP: Schema.optional(Schema.Number),
    temperature: Schema.optional(Schema.Number),
    color: Schema.optional(Schema.String),
    permission: Schema.Array(
      Schema.Struct({
        permission: Schema.String,
        pattern: Schema.String,
        action: Schema.Literals(["allow", "deny", "ask"]),
      }),
    ),
    model: Schema.optional(ModelRef),
    advisor: Schema.optional(
      Schema.Struct({
        model: ModelRef,
        maxUses: Schema.optional(Schema.Number),
      }),
    ),
    variant: Schema.optional(Schema.String),
    prompt: Schema.optional(Schema.String),
    options: Schema.Record(Schema.String, Schema.Unknown),
    steps: Schema.optional(Schema.Number),
  }).annotate({ identifier: "Agent" })

  export const SkillInfo = Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    location: Schema.String,
    category: Schema.optional(Schema.String),
    tags: Schema.optional(Schema.Array(Schema.String)),
    version: Schema.optional(Schema.String),
  }).annotate({ identifier: "Skill" })

  export const LspStatus = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    root: Schema.String,
    status: Schema.Literals(["connected", "error"]),
  }).annotate({ identifier: "LSPStatus" })

  export const FormatterStatus = Schema.Struct({
    name: Schema.String,
    extensions: Schema.Array(Schema.String),
    enabled: Schema.Boolean,
  }).annotate({ identifier: "FormatterStatus" })

  export const DisposeResult = Schema.Boolean.annotate({ identifier: "InstanceDisposeResult" })

  export const Group = HttpApiGroup.make("top-level")
    .add(HttpApiEndpoint.post("dispose", "/instance/dispose", { success: DisposeResult }))
    .add(HttpApiEndpoint.get("path", "/path", { success: Path }))
    .add(HttpApiEndpoint.get("vcs", "/vcs", { success: VcsInfo }))
    .add(HttpApiEndpoint.get("command", "/command", { success: Schema.Array(CommandInfo) }))
    .add(HttpApiEndpoint.get("agent", "/agent", { success: Schema.Array(AgentInfo) }))
    .add(HttpApiEndpoint.get("skill", "/skill", { success: Schema.Array(SkillInfo) }))
    .add(HttpApiEndpoint.get("lsp", "/lsp", { success: Schema.Array(LspStatus) }))
    .add(HttpApiEndpoint.get("formatter", "/formatter", { success: Schema.Array(FormatterStatus) }))

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    dispose: () => Effect.promise(() => Instance.dispose()).pipe(Effect.as(true)),
    path: () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return {
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: ctx.worktree,
          directory: ctx.directory,
        }
      }),
    vcs: () =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        return {
          branch: yield* vcs.branch(),
        }
      }),
    command: () =>
      Effect.gen(function* () {
        const command = yield* Command.Service
        return yield* command.list()
      }).pipe(Effect.orDie),
    agent: () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.list()
      }).pipe(Effect.orDie),
    skill: () =>
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        return yield* skill.all()
      }).pipe(Effect.orDie),
    lsp: () =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        return yield* lsp.status()
      }).pipe(Effect.orDie),
    formatter: () =>
      Effect.gen(function* () {
        const format = yield* Format.Service
        return yield* format.status()
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "top-level", (builder) =>
    builder
      .handle("dispose", handlers.dispose)
      .handle("path", handlers.path)
      .handle("vcs", handlers.vcs)
      .handle("command", handlers.command)
      .handle("agent", handlers.agent)
      .handle("skill", handlers.skill)
      .handle("lsp", handlers.lsp)
      .handle("formatter", handlers.formatter),
  )

  export const DependenciesLive = Layer.mergeAll(
    Vcs.defaultLayer,
    Command.defaultLayer,
    Agent.defaultLayer,
    Skill.defaultLayer,
    LSP.defaultLayer,
    Format.defaultLayer,
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
