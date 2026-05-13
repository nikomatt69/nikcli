import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer } from "effect"
import { PermissionNext } from "@/permission/next"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { ConfigHttpApi } from "./config"
import { ExperimentalHttpApi } from "./experimental"
import { FileHttpApi } from "./file"
import { McpHttpApi } from "./mcp"
import { PermissionHttpApi } from "./permission"
import { ProjectHttpApi } from "./project"
import { ProviderHttpApi } from "./provider"
import { QuestionHttpApi } from "./question"
import { SessionHttpApi } from "./session"
import { TopLevelHttpApi } from "./top-level"
import { WorkspaceHttpApi } from "./workspace"

export namespace PublicHttpApi {
  export const Api = HttpApi.make("nikcli")
    .add(TopLevelHttpApi.Group)
    .add(ConfigHttpApi.Group)
    .add(ExperimentalHttpApi.Group)
    .add(FileHttpApi.Group)
    .add(McpHttpApi.Group)
    .add(ProjectHttpApi.Group)
    .add(ProviderHttpApi.Group)
    .add(QuestionHttpApi.Group)
    .add(PermissionHttpApi.Group)
    .add(SessionHttpApi.Group)
    .add(WorkspaceHttpApi.Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  const QuestionHandlersLive = HttpApiBuilder.group(Api, "question", (handlers) =>
    handlers
      .handle("list", () => QuestionHttpApi.handlers.list())
      .handle("reply", (request) => QuestionHttpApi.handlers.reply(request))
      .handle("reject", (request) => QuestionHttpApi.handlers.reject(request)),
  )

  const PermissionHandlersLive = HttpApiBuilder.group(Api, "permission", (handlers) =>
    handlers
      .handle("list", () => PermissionHttpApi.handlers.list())
      .handle("reply", (request) => PermissionHttpApi.handlers.reply(request)),
  )

  const TopLevelHandlersLive = HttpApiBuilder.group(Api, "top-level", (handlers) =>
    handlers
      .handle("dispose", () => TopLevelHttpApi.handlers.dispose())
      .handle("path", () => TopLevelHttpApi.handlers.path())
      .handle("vcs", () => TopLevelHttpApi.handlers.vcs())
      .handle("command", () => TopLevelHttpApi.handlers.command())
      .handle("agent", () => TopLevelHttpApi.handlers.agent())
      .handle("skill", () => TopLevelHttpApi.handlers.skill())
      .handle("lsp", () => TopLevelHttpApi.handlers.lsp())
      .handle("formatter", () => TopLevelHttpApi.handlers.formatter()),
  )

  const ConfigHandlersLive = HttpApiBuilder.group(Api, "config", (handlers) =>
    handlers
      .handle("get", () => ConfigHttpApi.handlers.get())
      .handle("update", (request) => ConfigHttpApi.handlers.update(request))
      .handle("providers", () => ConfigHttpApi.handlers.providers()),
  )

  const FileHandlersLive = HttpApiBuilder.group(Api, "file", (handlers) =>
    handlers
      .handle("findText", (request) => FileHttpApi.handlers.findText(request))
      .handle("findFile", (request) => FileHttpApi.handlers.findFile(request))
      .handle("findSymbol", (request) => FileHttpApi.handlers.findSymbol(request))
      .handle("list", (request) => FileHttpApi.handlers.list(request))
      .handle("content", (request) => FileHttpApi.handlers.content(request))
      .handle("write", (request) => FileHttpApi.handlers.write(request))
      .handle("status", () => FileHttpApi.handlers.status()),
  )

  const ExperimentalHandlersLive = HttpApiBuilder.group(Api, "experimental", (handlers) =>
    handlers
      .handle("toolIDs", () => ExperimentalHttpApi.handlers.toolIDs())
      .handle("tools", (request) => ExperimentalHttpApi.handlers.tools(request))
      .handle("worktreeCreate", (request) => ExperimentalHttpApi.handlers.worktreeCreate(request))
      .handle("worktree", () => ExperimentalHttpApi.handlers.worktree())
      .handle("worktreeRemove", (request) => ExperimentalHttpApi.handlers.worktreeRemove(request))
      .handle("worktreeReset", (request) => ExperimentalHttpApi.handlers.worktreeReset(request))
      .handle("resource", () => ExperimentalHttpApi.handlers.resource()),
  )

  const McpHandlersLive = HttpApiBuilder.group(Api, "mcp", (handlers) =>
    handlers
      .handle("status", () => McpHttpApi.handlers.status())
      .handle("add", (request) => McpHttpApi.handlers.add(request))
      .handle("startAuth", (request) => McpHttpApi.handlers.startAuth(request))
      .handle("authCallback", (request) => McpHttpApi.handlers.authCallback(request))
      .handle("authenticate", (request) => McpHttpApi.handlers.authenticate(request))
      .handle("removeAuth", (request) => McpHttpApi.handlers.removeAuth(request))
      .handle("connect", (request) => McpHttpApi.handlers.connect(request))
      .handle("disconnect", (request) => McpHttpApi.handlers.disconnect(request))
      .handle("toggle", (request) => McpHttpApi.handlers.toggle(request)),
  )

  const ProjectHandlersLive = HttpApiBuilder.group(Api, "project", (handlers) =>
    handlers
      .handle("list", () => ProjectHttpApi.handlers.list())
      .handle("current", () => ProjectHttpApi.handlers.current())
      .handle("update", (request) => ProjectHttpApi.handlers.update(request)),
  )

  const WorkspaceHandlersLive = HttpApiBuilder.group(Api, "workspace", (handlers) =>
    handlers
      .handle("adaptors", () => WorkspaceHttpApi.handlers.adaptors())
      .handle("create", (request) => WorkspaceHttpApi.handlers.create(request))
      .handle("list", () => WorkspaceHttpApi.handlers.list())
      .handle("remove", (request) => WorkspaceHttpApi.handlers.remove(request))
      .handle("restore", (request) => WorkspaceHttpApi.handlers.restore(request))
      .handle("sessionRestore", (request) => WorkspaceHttpApi.handlers.sessionRestore(request)),
  )

  const ProviderHandlersLive = HttpApiBuilder.group(Api, "provider", (handlers) =>
    handlers
      .handle("list", () => ProviderHttpApi.handlers.list())
      .handle("auth", () => ProviderHttpApi.handlers.auth())
      .handle("api", (request) => ProviderHttpApi.handlers.api(request))
      .handle("removeAuth", (request) => ProviderHttpApi.handlers.removeAuth(request)),
  )

  const SessionHandlersLive = HttpApiBuilder.group(Api, "session", (handlers) =>
    handlers
      .handle("list", (request) => SessionHttpApi.handlers.list(request))
      .handle("create", (request) => SessionHttpApi.handlers.create(request))
      .handle("status", () => SessionHttpApi.handlers.status())
      .handle("get", (request) => SessionHttpApi.handlers.get(request))
      .handle("remove", (request) => SessionHttpApi.handlers.remove(request))
      .handle("update", (request) => SessionHttpApi.handlers.update(request))
      .handle("fork", (request) => SessionHttpApi.handlers.fork(request))
      .handle("abort", (request) => SessionHttpApi.handlers.abort(request))
      .handle("revert", (request) => SessionHttpApi.handlers.revert(request))
      .handle("unrevert", (request) => SessionHttpApi.handlers.unrevert(request))
      .handle("children", (request) => SessionHttpApi.handlers.children(request))
      .handle("todo", (request) => SessionHttpApi.handlers.todo(request))
      .handle("diff", (request) => SessionHttpApi.handlers.diff(request))
      .handle("messages", (request) => SessionHttpApi.handlers.messages(request))
      .handle("message", (request) => SessionHttpApi.handlers.message(request))
      .handle("messageRemove", (request) => SessionHttpApi.handlers.messageRemove(request))
      .handle("partRemove", (request) => SessionHttpApi.handlers.partRemove(request))
      .handle("partUpdate", (request) => SessionHttpApi.handlers.partUpdate(request)),
  )

  export const layer = ApiLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        TopLevelHandlersLive.pipe(Layer.provide(TopLevelHttpApi.DependenciesLive)),
        ConfigHandlersLive.pipe(Layer.provide(ConfigHttpApi.DependenciesLive)),
        ExperimentalHandlersLive.pipe(Layer.provide(ExperimentalHttpApi.DependenciesLive)),
        FileHandlersLive.pipe(Layer.provide(FileHttpApi.DependenciesLive)),
        McpHandlersLive.pipe(Layer.provide(McpHttpApi.DependenciesLive)),
        ProjectHandlersLive.pipe(Layer.provide(Project.defaultLayer)),
        ProviderHandlersLive.pipe(Layer.provide(ProviderHttpApi.DependenciesLive)),
        QuestionHandlersLive.pipe(Layer.provide(Question.defaultLayer)),
        PermissionHandlersLive.pipe(Layer.provide(PermissionNext.defaultLayer)),
        SessionHandlersLive.pipe(Layer.provide(SessionHttpApi.DependenciesLive)),
        WorkspaceHandlersLive,
      ),
    ),
  )
}
