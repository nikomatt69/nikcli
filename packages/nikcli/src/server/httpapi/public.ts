import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer } from "effect"
import { PermissionNext } from "@/permission/next"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { AnalyticsHttpApi } from "./analytics"
import { AppHttpApi } from "./app"
import { BrainHttpApi } from "./brain"
import { ConfigHttpApi } from "./config"
import { ConnectorsHttpApi } from "./connectors"
import { DoctorHttpApi } from "./doctor"
import { ExperimentalHttpApi } from "./experimental"
import { FileHttpApi } from "./file"
import { GlobalHttpApi } from "./global"
import { McpHttpApi } from "./mcp"
import { MissionHttpApi } from "./mission"
import { PermissionHttpApi } from "./permission"
import { ProjectHttpApi } from "./project"
import { ProviderHttpApi } from "./provider"
import { PtyHttpApi } from "./pty"
import { LoopHttpApi } from "./loop"
import { QuestionHttpApi } from "./question"
import { SessionHttpApi } from "./session"
import { SyncHttpApi } from "./sync"
import { TopLevelHttpApi } from "./top-level"
import { TuiHttpApi } from "./tui"
import { WorkspaceHttpApi } from "./workspace"

export namespace PublicHttpApi {
  export const Api = HttpApi.make("nikcli")
    .add(TopLevelHttpApi.Group)
    .add(AnalyticsHttpApi.Group)
    .add(AppHttpApi.Group)
    .add(BrainHttpApi.Group)
    .add(ConfigHttpApi.Group)
    .add(ConnectorsHttpApi.Group)
    .add(DoctorHttpApi.Group)
    .add(ExperimentalHttpApi.Group)
    .add(FileHttpApi.Group)
    .add(GlobalHttpApi.Group)
    .add(McpHttpApi.Group)
    .add(MissionHttpApi.Group)
    .add(ProjectHttpApi.Group)
    .add(ProviderHttpApi.Group)
    .add(QuestionHttpApi.Group)
    .add(PermissionHttpApi.Group)
    .add(PtyHttpApi.Group)
    .add(LoopHttpApi.Group)
    .add(SessionHttpApi.Group)
    .add(SyncHttpApi.Group)
    .add(TuiHttpApi.Group)
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
      .handle("vcsStatus", () => TopLevelHttpApi.handlers.vcsStatus())
      .handle("vcsDiffRaw", () => TopLevelHttpApi.handlers.vcsDiffRaw())
      .handle("vcsApply", (request) => TopLevelHttpApi.handlers.vcsApply(request))
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
      .handle("resource", () => ExperimentalHttpApi.handlers.resource())
      .handle("managedWorktreeCreate", (request) => ExperimentalHttpApi.handlers.managedWorktreeCreate(request))
      .handle("managedWorktreeRemove", (request) => ExperimentalHttpApi.handlers.managedWorktreeRemove(request))
      .handle("managedWorktreeLink", (request) => ExperimentalHttpApi.handlers.managedWorktreeLink(request))
      .handle("managedWorktreeChildren", (request) => ExperimentalHttpApi.handlers.managedWorktreeChildren(request))
      .handle("managedWorktreeAncestors", (request) => ExperimentalHttpApi.handlers.managedWorktreeAncestors(request))
      .handle("managedWorktreeList", () => ExperimentalHttpApi.handlers.managedWorktreeList()),
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

  const TuiHandlersLive = HttpApiBuilder.group(Api, "tui", (handlers) =>
    handlers
      .handle("appendPrompt", (request) => TuiHttpApi.handlers.appendPrompt(request))
      .handle("openHelp", () => TuiHttpApi.handlers.openHelp())
      .handle("openSessions", () => TuiHttpApi.handlers.openSessions())
      .handle("openThemes", () => TuiHttpApi.handlers.openThemes())
      .handle("openModels", () => TuiHttpApi.handlers.openModels())
      .handle("submitPrompt", () => TuiHttpApi.handlers.submitPrompt())
      .handle("clearPrompt", () => TuiHttpApi.handlers.clearPrompt())
      .handle("executeCommand", (request) => TuiHttpApi.handlers.executeCommand(request))
      .handle("showToast", (request) => TuiHttpApi.handlers.showToast(request))
      .handle("publish", (request) => TuiHttpApi.handlers.publish(request))
      .handle("selectSession", (request) => TuiHttpApi.handlers.selectSession(request))
      .handle("controlNext", () => TuiHttpApi.handlers.controlNext())
      .handle("controlResponse", (request) => TuiHttpApi.handlers.controlResponse(request)),
  )

  const WorkspaceHandlersLive = HttpApiBuilder.group(Api, "workspace", (handlers) =>
    handlers
      .handle("adaptors", () => WorkspaceHttpApi.handlers.adaptors())
      .handle("syncList", () => WorkspaceHttpApi.handlers.syncList())
      .handle("status", () => WorkspaceHttpApi.handlers.status())
      .handle("create", (request) => WorkspaceHttpApi.handlers.create(request))
      .handle("list", () => WorkspaceHttpApi.handlers.list())
      .handle("remove", (request) => WorkspaceHttpApi.handlers.remove(request))
      .handle("restore", (request) => WorkspaceHttpApi.handlers.restore(request))
      .handle("sessionRestore", (request) => WorkspaceHttpApi.handlers.sessionRestore(request))
      .handle("warp", (request) => WorkspaceHttpApi.handlers.warp(request)),
  )

  const ProviderHandlersLive = HttpApiBuilder.group(Api, "provider", (handlers) =>
    handlers
      .handle("list", () => ProviderHttpApi.handlers.list())
      .handle("auth", () => ProviderHttpApi.handlers.auth())
      .handle("api", (request) => ProviderHttpApi.handlers.api(request))
      .handle("removeAuth", (request) => ProviderHttpApi.handlers.removeAuth(request))
      .handle("oauthAuthorize", (request) => ProviderHttpApi.handlers.oauthAuthorize(request))
      .handle("oauthCallback", (request) => ProviderHttpApi.handlers.oauthCallback(request)),
  )

  const PtyHandlersLive = HttpApiBuilder.group(Api, "pty", (handlers) =>
    handlers
      .handle("list", () => PtyHttpApi.handlers.list())
      .handle("create", (request) => PtyHttpApi.handlers.create(request))
      .handle("get", (request) => PtyHttpApi.handlers.get(request))
      .handle("update", (request) => PtyHttpApi.handlers.update(request))
      .handle("remove", (request) => PtyHttpApi.handlers.remove(request)),
  )

  const LoopHandlersLive = HttpApiBuilder.group(Api, "loop", (handlers) =>
    handlers
      .handle("list", () => LoopHttpApi.handlers.list())
      .handle("templates", () => LoopHttpApi.handlers.templates())
      .handle("generate", (request) => LoopHttpApi.handlers.generate(request))
      .handle("recentRuns", (request) => LoopHttpApi.handlers.recentRuns(request))
      .handle("get", (request) => LoopHttpApi.handlers.get(request))
      .handle("upsert", (request) => LoopHttpApi.handlers.upsert(request))
      .handle("update", (request) => LoopHttpApi.handlers.update(request))
      .handle("remove", (request) => LoopHttpApi.handlers.remove(request))
      .handle("toggle", (request) => LoopHttpApi.handlers.toggle(request))
      .handle("run", (request) => LoopHttpApi.handlers.run(request))
      .handle("abort", (request) => LoopHttpApi.handlers.abort(request))
      .handle("pause", (request) => LoopHttpApi.handlers.pause(request))
      .handle("resume", (request) => LoopHttpApi.handlers.resume(request))
      .handle("runs", (request) => LoopHttpApi.handlers.runs(request)),
  )

  const DoctorHandlersLive = HttpApiBuilder.group(Api, "doctor", (handlers) =>
    handlers.handle("run", () => DoctorHttpApi.handlers.run()),
  )

  const AppHandlersLive = HttpApiBuilder.group(Api, "app", (handlers) =>
    handlers
      .handle("log", (request) => AppHttpApi.handlers.log(request))
      .handle("skillCreate", (request) => AppHttpApi.handlers.skillCreate(request))
      .handle("skillDelete", (request) => AppHttpApi.handlers.skillDelete(request)),
  )

  const GlobalHandlersLive = HttpApiBuilder.group(Api, "global", (handlers) =>
    handlers
      .handle("health", () => GlobalHttpApi.handlers.health())
      .handle("dispose", () => GlobalHttpApi.handlers.dispose()),
  )

  const BrainHandlersLive = HttpApiBuilder.group(Api, "brain", (handlers) =>
    handlers
      .handle("status", () => BrainHttpApi.handlers.status())
      .handle("trigger", (request) => BrainHttpApi.handlers.trigger(request)),
  )

  const ConnectorsHandlersLive = HttpApiBuilder.group(Api, "connectors", (handlers) =>
    handlers
      .handle("status", () => ConnectorsHttpApi.handlers.status())
      .handle("authSet", (request) => ConnectorsHttpApi.handlers.authSet(request))
      .handle("authRemove", (request) => ConnectorsHttpApi.handlers.authRemove(request))
      .handle("invalidate", (request) => ConnectorsHttpApi.handlers.invalidate(request)),
  )

  const AnalyticsHandlersLive = HttpApiBuilder.group(Api, "analytics", (handlers) =>
    handlers
      .handle("global", () => AnalyticsHttpApi.handlers.global())
      .handle("daily", (request) => AnalyticsHttpApi.handlers.daily(request))
      .handle("session", (request) => AnalyticsHttpApi.handlers.session(request))
      .handle("sessions", () => AnalyticsHttpApi.handlers.sessions())
      .handle("leaderboard", () => AnalyticsHttpApi.handlers.leaderboard()),
  )

  const MissionHandlersLive = HttpApiBuilder.group(Api, "mission", (handlers) =>
    handlers
      .handle("list", () => MissionHttpApi.handlers.list())
      .handle("templates", () => MissionHttpApi.handlers.templates())
      .handle("generate", (request) => MissionHttpApi.handlers.generate(request))
      .handle("recentExecs", (request) => MissionHttpApi.handlers.recentExecs(request))
      .handle("get", (request) => MissionHttpApi.handlers.get(request))
      .handle("upsert", (request) => MissionHttpApi.handlers.upsert(request))
      .handle("update", (request) => MissionHttpApi.handlers.update(request))
      .handle("remove", (request) => MissionHttpApi.handlers.remove(request))
      .handle("start", (request) => MissionHttpApi.handlers.start(request))
      .handle("pause", (request) => MissionHttpApi.handlers.pause(request))
      .handle("cancel", (request) => MissionHttpApi.handlers.cancel(request))
      .handle("featureMutate", (request) => MissionHttpApi.handlers.featureMutate(request))
      .handle("execs", (request) => MissionHttpApi.handlers.execs(request)),
  )

  const SyncHandlersLive = HttpApiBuilder.group(Api, "sync", (handlers) =>
    handlers
      .handle("start", (request) => SyncHttpApi.handlers.start(request))
      .handle("replay", (request) => SyncHttpApi.handlers.replay(request))
      .handle("history", (request) => SyncHttpApi.handlers.history(request))
      .handle("snapshot", (request) => SyncHttpApi.handlers.snapshot(request)),
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
      .handle("share", (request) => SessionHttpApi.handlers.share(request))
      .handle("unshare", (request) => SessionHttpApi.handlers.unshare(request))
      .handle("summarize", (request) => SessionHttpApi.handlers.summarize(request))
      .handle("command", (request) => SessionHttpApi.handlers.command(request))
      .handle("shell", (request) => SessionHttpApi.handlers.shell(request))
      .handle("permissionRespond", (request) => SessionHttpApi.handlers.permissionRespond(request))
      .handle("children", (request) => SessionHttpApi.handlers.children(request))
      .handle("todo", (request) => SessionHttpApi.handlers.todo(request))
      .handle("diff", (request) => SessionHttpApi.handlers.diff(request))
      .handle("messages", (request) => SessionHttpApi.handlers.messages(request))
      .handle("message", (request) => SessionHttpApi.handlers.message(request))
      .handle("messageRemove", (request) => SessionHttpApi.handlers.messageRemove(request))
      .handle("partRemove", (request) => SessionHttpApi.handlers.partRemove(request))
      .handle("partUpdate", (request) => SessionHttpApi.handlers.partUpdate(request))
      .handle("v2Entries", (request) => SessionHttpApi.handlers.v2Entries(request))
      .handle("v2State", (request) => SessionHttpApi.handlers.v2State(request))
      .handle("v2Events", (request) => SessionHttpApi.handlers.v2Events(request))
      .handle("instructions", (request) => SessionHttpApi.handlers.instructions(request))
      .handle("contextBreakdown", (request) => SessionHttpApi.handlers.contextBreakdown(request))
      .handle("contextToggle", (request) => SessionHttpApi.handlers.contextToggle(request))
      .handle("goal", (request) => SessionHttpApi.handlers.goal(request))
      .handle("background", (request) => SessionHttpApi.handlers.background(request))
      .handle("backgroundInspect", (request) => SessionHttpApi.handlers.backgroundInspect(request))
      .handle("backgroundRead", (request) => SessionHttpApi.handlers.backgroundRead(request))
      .handle("backgroundCancel", (request) => SessionHttpApi.handlers.backgroundCancel(request))
      .handle("monitor", (request) => SessionHttpApi.handlers.monitor(request))
      .handle("monitorLog", (request) => SessionHttpApi.handlers.monitorLog(request))
      .handle("monitorCancel", (request) => SessionHttpApi.handlers.monitorCancel(request)),
  )

  export const layer = ApiLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        TopLevelHandlersLive.pipe(Layer.provide(TopLevelHttpApi.DependenciesLive)),
        AnalyticsHandlersLive,
        AppHandlersLive.pipe(Layer.provide(AppHttpApi.DependenciesLive)),
        BrainHandlersLive,
        ConfigHandlersLive.pipe(Layer.provide(ConfigHttpApi.DependenciesLive)),
        ConnectorsHandlersLive.pipe(Layer.provide(ConnectorsHttpApi.DependenciesLive)),
        DoctorHandlersLive.pipe(Layer.provide(DoctorHttpApi.DependenciesLive)),
        ExperimentalHandlersLive.pipe(Layer.provide(ExperimentalHttpApi.DependenciesLive)),
        FileHandlersLive.pipe(Layer.provide(FileHttpApi.DependenciesLive)),
        GlobalHandlersLive,
        McpHandlersLive.pipe(Layer.provide(McpHttpApi.DependenciesLive)),
        ProjectHandlersLive.pipe(Layer.provide(Project.defaultLayer)),
        ProviderHandlersLive.pipe(Layer.provide(ProviderHttpApi.DependenciesLive)),
        PtyHandlersLive.pipe(Layer.provide(PtyHttpApi.DependenciesLive)),
        QuestionHandlersLive.pipe(Layer.provide(Question.defaultLayer)),
        PermissionHandlersLive.pipe(Layer.provide(PermissionNext.defaultLayer)),
        LoopHandlersLive,
        MissionHandlersLive,
        SessionHandlersLive.pipe(Layer.provide(SessionHttpApi.DependenciesLive)),
        SyncHandlersLive.pipe(Layer.provide(SyncHttpApi.DependenciesLive)),
        TuiHandlersLive.pipe(Layer.provide(TuiHttpApi.DependenciesLive)),
        WorkspaceHandlersLive,
      ),
    ),
  )
}
