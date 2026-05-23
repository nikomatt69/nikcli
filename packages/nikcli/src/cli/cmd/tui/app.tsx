import { render, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import { Clipboard } from "@tui/util/clipboard"
import * as Sound from "@tui/util/sound"
import { RouteProvider, useRoute } from "@tui/context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  untrack,
  ErrorBoundary,
  createSignal,
  onMount,
  onCleanup,
  batch,
  Show,
  on,
} from "solid-js"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderList, DialogProviderDisconnect } from "@tui/component/dialog-provider"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { ProjectProvider } from "@tui/context/project"
import { ServerProvider, useServer } from "@tui/context/server"
import { SyncProvider, useSync } from "@tui/context/sync"
import { AnalyticsProvider } from "@tui/context/analytics"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel, useConnected } from "@tui/component/dialog-model"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogRoutine } from "@tui/component/dialog-routine"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogUsage } from "@tui/component/dialog-usage"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogSettings } from "@tui/component/dialog-settings"
import { DialogConfig } from "@tui/component/dialog-config"
import { DialogHelp } from "./ui/dialog-help"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogAdvisorModel } from "@tui/component/dialog-advisor-model"
import { DialogSkills } from "@tui/component/dialog-skills"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { DialogSessionWarp } from "@tui/component/dialog-session-warp"
import { DialogWorkspaceList } from "@tui/component/dialog-workspace-list"
import { DialogVariant } from "@tui/component/dialog-variant"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { Changes } from "@tui/routes/changes"
import { SessionTree } from "@tui/routes/tree"
import { GitGraph } from "@tui/routes/git-graph"
import { GitHubPanel } from "@tui/routes/github"
import { Workspace } from "@tui/routes/workspace"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { writeHeapSnapshot } from "v8"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { EditorContextProvider } from "./context/editor"
import { TuiConfig } from "@/config/tui"
import { withInstanceAsync } from "@/effect"
import { TuiPluginRuntime, createTuiApi, type RouteMap } from "./plugin"
import { ErrorComponent } from "./component/error-component"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { StartupLoading } from "./component/startup-loading"
import { initBrainScheduler } from "@/brain/scheduler"
import { BRAIN_SESSION_TITLE } from "@/brain"
import { DialogWebPreview } from "@tui/component/dialog-web-preview"
import { UserDB } from "@/db/users"
import { DialogLogin } from "@tui/component/dialog-login"
import { DialogOnboarding } from "@tui/component/dialog-onboarding"
import { DialogAuthManage } from "@tui/component/dialog-auth-manage"
import { DialogChat } from "@tui/component/dialog-chat"
import { DialogAnalytics } from "@tui/component/dialog-analytics"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"

function rendererConfig(tuiCfg: TuiConfig.Info): CliRendererConfig {
  return {
    targetFps: 45,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    useMouse: tuiCfg.mouse ?? true,
    consoleOptions: {
      keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
      onCopySelection: (text) => {
        Clipboard.copy(text).catch((error) => {
          console.error(`Failed to copy console selection to clipboard: ${error}`)
        })
      },
    },
  }
}

import type { EventSource } from "./context/sdk"

export function tui(input: {
  url: string
  args: Args
  directory?: string
  fetch?: typeof fetch
  events?: EventSource
  onExit?: () => Promise<void>
  startServer?: () => Promise<string>
}) {
  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const unguard = win32InstallCtrlCGuard()
    win32DisableProcessedInput()
    const tuiCfg = await TuiConfig.get().catch(() => ({}) as TuiConfig.Info)
    const renderer = await createCliRenderer(rendererConfig(tuiCfg))
    void renderer.getPalette({ size: 16 }).catch(() => undefined)
    const mode = (await (renderer as any).waitForThemeMode?.(1000)) ?? "dark"
    const onExit = async () => {
      unguard?.()
      await input.onExit?.()
      resolve()
    }

    await render(() => {
      return (
        <ErrorBoundary
          fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} mode={mode} />}
        >
          <ArgsProvider {...input.args}>
            <ExitProvider onExit={onExit} onBeforeExit={() => TuiPluginRuntime.dispose()}>
              <ServerProvider startServer={input.startServer}>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <SDKProvider
                        url={input.url}
                        directory={input.directory}
                        fetch={input.fetch}
                        events={input.events}
                      >
                        <ProjectProvider>
                          <SyncProvider>
                            <AnalyticsProvider>
                              <ThemeProvider mode={mode}>
                                <LocalProvider>
                                  <KeybindProvider>
                                    <PromptStashProvider>
                                      <DialogProvider>
                                        <CommandProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <EditorContextProvider>
                                                <PromptRefProvider>
                                                  <App />
                                                </PromptRefProvider>
                                              </EditorContextProvider>
                                            </PromptHistoryProvider>
                                          </FrecencyProvider>
                                        </CommandProvider>
                                      </DialogProvider>
                                    </PromptStashProvider>
                                  </KeybindProvider>
                                </LocalProvider>
                              </ThemeProvider>
                            </AnalyticsProvider>
                          </SyncProvider>
                        </ProjectProvider>
                      </SDKProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ServerProvider>
            </ExitProvider>
          </ArgsProvider>
        </ErrorBoundary>
      )
    })
  })
}

function LegacyRedirect(props: {
  tab: "tree" | "changes" | "graph" | "github"
  sessionID?: string
  workspaceID?: string
}) {
  const route = useRoute()
  onMount(() => {
    route.navigate({
      type: "workspace",
      tab: props.tab,
      sessionID: props.sessionID,
      workspaceID: props.workspaceID,
    })
  })
  return null
}

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  renderer.externalOutputMode = "passthrough"
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const sdk = useSDK()
  const toast = useToast()
  const themeCtx = useTheme()
  const { theme, mode, setMode } = themeCtx
  const sync = useSync()
  const exit = useExit()
  const promptRef = usePromptRef()
  const keybind = useKeybind()

  // Plugin routes — mutable map + reactive stamp for re-renders
  const routes: RouteMap = new Map()
  const [pluginRouteKey, setPluginRouteKey] = createSignal(0)
  const bump = () => setPluginRouteKey((k) => k + 1)
  const [pluginsReady, setPluginsReady] = createSignal(false)
  const [onboardingActive, setOnboardingActive] = createSignal(false)

  onMount(() => {
    void (async () => {
      const isFirstRun = !UserDB.hasUsers()

      const storedToken = UserDB.getActiveSessionSync()
      const validUser = storedToken ? UserDB.verifySession(storedToken) : null

      if (isFirstRun && !kv.get("onboarding_complete", false)) {
        // First-time user: unified onboarding handles account creation + provider setup
        setOnboardingActive(true)
        await DialogOnboarding.run(dialog)
        setOnboardingActive(false)
        // Mark complete only if an account was actually created
        const postToken = UserDB.getActiveSessionSync()
        const postUser = postToken ? UserDB.verifySession(postToken) : null
        if (postUser) {
          kv.set("onboarding_complete", true)
          const needsProvider = untrack(() => sync.status === "complete" && sync.data.provider.length === 0)
          if (needsProvider && dialog.stack.length === 0) {
            dialog.replace(() => <DialogProviderList />)
          }
        }
      } else if (!validUser) {
        // Returning user with no active session: standard login
        await DialogLogin.run(dialog)
      }

      const tuiConfig = await withInstanceAsync({ directory: sdk.directory || process.cwd() }, async () => {
        initBrainScheduler()
        return TuiConfig.get()
      })
      const api = createTuiApi({
        command,
        tuiConfig,
        dialog,
        keybind,
        kv,
        route,
        routes,
        bump,
        sdk,
        sync,
        theme: themeCtx,
        toast,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderer: renderer as any,
      })
      await TuiPluginRuntime.init(api)
      setPluginsReady(true)
    })().catch((error) => {
      setOnboardingActive(false)
      setPluginsReady(true)
      toast.error(error)
    })
  })

  onCleanup(() => {
    void TuiPluginRuntime.dispose()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)
    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))

  // Update terminal window title based on current route and session
  createEffect(
    on(
      () => ({
        enabled: terminalTitleEnabled(),
        type: route.data.type,
        sessionID:
          route.data.type === "session" || route.data.type === "changes" || route.data.type === "tree"
            ? ((route.data as any).sessionID ?? null)
            : null,
        title:
          route.data.type === "github"
            ? "GitHub"
            : route.data.type === "session" || route.data.type === "changes" || route.data.type === "tree"
              ? (route.data as any).sessionID
                ? (sync.session.get((route.data as any).sessionID)?.title ?? null)
                : null
              : null,
      }),
      (state) => {
        if (!state.enabled || Flag.NIKCLI_DISABLE_TERMINAL_TITLE) {
          renderer.setTerminalTitle("")
          return
        }

        if (state.type === "home") {
          renderer.setTerminalTitle("Nikcli")
          return
        }

        if (state.type === "session" && state.sessionID) {
          if (!state.title || SessionApi.isDefaultTitle(state.title)) {
            renderer.setTerminalTitle("Nikcli")
            return
          }
          const title = state.title.length > 40 ? state.title.slice(0, 37) + "..." : state.title
          renderer.setTerminalTitle(`Nikcli | ${title}`)
          return
        }

        if (state.type === "git-graph" || state.type === "github") {
          renderer.setTerminalTitle("Nikcli | GitHub")
          return
        }

        if (state.type === "workspace") {
          renderer.setTerminalTitle("Nikcli | Workspace")
          return
        }
      },
      { defer: true },
    ),
  )

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Provider.parseModel(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
          workspaceID: sync.session.get(args.sessionID)?.workspaceID,
        })
      }
    })
  })

  let continued = false
  createEffect(
    on(
      () => [continued, sync.status, args.continue],
      () => {
        if (continued || sync.status === "loading" || !args.continue) return
        const match = sync.data.session
          .toSorted((a, b) => b.time.updated - a.time.updated)
          .find((x) => x.parentID === undefined)?.id
        if (match) {
          continued = true
          route.navigate({
            type: "session",
            sessionID: match,
            workspaceID: sync.session.get(match)?.workspaceID,
          })
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        if (onboardingActive()) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  const connected = useConnected()
  command.register(() => [
    {
      title: "Switch session",
      value: "session.list",
      keybind: "session_list",
      category: "Session",
      suggested: sync.data.session.length > 0,
      slash: {
        name: "sessions",
        aliases: ["resume", "continue"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogSessionList />)
      },
    },
    {
      title: "Manage workspaces",
      value: "workspace.list",
      category: "Workspace",
      suggested: true,
      slash: {
        name: "workspaces",
      },
      onSelect: () => {
        dialog.replace(() => <DialogWorkspaceList />)
      },
    },
    {
      title: "Warp session",
      value: "workspace.warp",
      category: "Workspace",
      enabled: route.data.type === "session" && Flag.NIKCLI_EXPERIMENTAL_WORKSPACES_TUI,
      slash: {
        name: "warp",
      },
      onSelect: () => {
        const data = route.data
        if (data.type !== "session") return
        const sessionID = data.sessionID
        dialog.replace(() => <DialogSessionWarp sessionID={sessionID} />)
      },
    },
    {
      title: "New session",
      suggested: route.data.type === "session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      slash: {
        name: "new",
        aliases: ["clear"],
      },
      onSelect: () => {
        const current = promptRef.current
        // Don't require focus - if there's any text, preserve it
        const currentPrompt = current?.current?.input ? current.current : undefined
        const workspaceID =
          route.data.type === "session"
            ? (route.data.workspaceID ?? sync.session.get(route.data.sessionID)?.workspaceID)
            : route.data.workspaceID
        route.navigate({
          type: "home",
          initialPrompt: currentPrompt,
          workspaceID,
        })
        dialog.clear()
      },
    },
    {
      title: "Workspace panel (sessions · changes · graph · github)",
      value: "workspace.open",
      category: "Git",
      suggested: true,
      slash: {
        name: "workspace",
        aliases: ["ws", "panel"],
      },
      onSelect: () => {
        const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
        const hasDiff = route.data.type === "session" && (sync.data.session_diff[route.data.sessionID]?.length ?? 0) > 0
        route.navigate({
          type: "workspace",
          tab: hasDiff ? "changes" : "tree",
          sessionID,
          workspaceID: sessionID
            ? (route.data.workspaceID ?? sync.session.get(sessionID)?.workspaceID)
            : route.data.workspaceID,
        })
        dialog.clear()
      },
    },
    // Hidden helpers so existing /changes /tree /graph /github slash commands still work
    // but don't clutter the command palette suggestion list.
    {
      title: "Open changes tab",
      value: "workspace.tab.changes",
      category: "Git",
      hidden: true,
      slash: { name: "changes" },
      onSelect: () => {
        const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
        route.navigate({
          type: "workspace",
          tab: "changes",
          sessionID,
          workspaceID: sessionID
            ? (route.data.workspaceID ?? sync.session.get(sessionID)?.workspaceID)
            : route.data.workspaceID,
        })
        dialog.clear()
      },
    },
    {
      title: "Open sessions tab",
      value: "workspace.tab.tree",
      category: "Git",
      hidden: true,
      slash: { name: "tree" },
      onSelect: () => {
        const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
        route.navigate({
          type: "workspace",
          tab: "tree",
          sessionID,
          workspaceID: sessionID
            ? (route.data.workspaceID ?? sync.session.get(sessionID)?.workspaceID)
            : route.data.workspaceID,
        })
        dialog.clear()
      },
    },
    {
      title: "Open commit graph tab",
      value: "workspace.tab.graph",
      category: "Git",
      hidden: true,
      slash: { name: "graph", aliases: ["gitgraph", "commits"] },
      onSelect: () => {
        const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
        route.navigate({
          type: "workspace",
          tab: "graph",
          sessionID,
          workspaceID: sessionID
            ? (route.data.workspaceID ?? sync.session.get(sessionID)?.workspaceID)
            : route.data.workspaceID,
        })
        dialog.clear()
      },
    },
    {
      title: "Open GitHub tab",
      value: "workspace.tab.github",
      category: "Git",
      hidden: true,
      slash: { name: "github", aliases: ["gh"] },
      onSelect: () => {
        const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
        route.navigate({
          type: "workspace",
          tab: "github",
          sessionID,
          workspaceID: sessionID
            ? (route.data.workspaceID ?? sync.session.get(sessionID)?.workspaceID)
            : route.data.workspaceID,
        })
        dialog.clear()
      },
    },
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      suggested: true,
      category: "Agent",
      slash: {
        name: "models",
      },
      onSelect: () => {
        dialog.replace(() => <DialogModel />)
      },
    },
    {
      title: "Model cycle",
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: "Favorite cycle",
      value: "model.cycle_favorite",
      keybind: "model_cycle_favorite",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(1)
      },
    },
    {
      title: "Favorite cycle reverse",
      value: "model.cycle_favorite_reverse",
      keybind: "model_cycle_favorite_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(-1)
      },
    },
    {
      title: "Switch agent",
      value: "agent.list",
      keybind: "agent_list",
      category: "Agent",
      slash: {
        name: "agents",
      },
      onSelect: () => {
        dialog.replace(() => <DialogAgent />)
      },
    },
    {
      title: "Set advisor model",
      value: "agent.advisor",
      category: "Agent",
      slash: {
        name: "advisor",
      },
      onSelect: () => {
        const name = local.agent.current()?.name
        if (!name) return
        dialog.replace(() => <DialogAdvisorModel agentName={name} />)
      },
    },
    {
      title: "Browse skills",
      value: "skill.list",
      category: "Agent",
      slash: {
        name: "skills",
      },
      onSelect: () => {
        dialog.replace(() => <DialogSkills />)
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      slash: {
        name: "mcps",
      },
      onSelect: () => {
        dialog.replace(() => <DialogMcp />)
      },
    },
    {
      title: "Routines",
      value: "routine.list",
      category: "System",
      slash: {
        name: "routines",
        aliases: ["routine"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogRoutine />)
      },
    },
    {
      title: "Agent cycle",
      value: "agent.cycle",
      keybind: "agent_cycle",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Variant cycle",
      value: "variant.cycle",
      keybind: "variant_cycle",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.variant.cycle()
      },
    },
    {
      title: "Select variant",
      value: "variant.select",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogVariant />)
      },
    },
    {
      title: "Agent cycle reverse",
      value: "agent.cycle.reverse",
      keybind: "agent_cycle_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "Connect provider",
      value: "provider.connect",
      suggested: !connected(),
      slash: {
        name: "connect",
      },
      onSelect: () => {
        dialog.replace(() => <DialogProviderList />)
      },
      category: "Provider",
    },
    {
      title: "Disconnect provider",
      value: "provider.disconnect",
      suggested: sync.data.provider_next.connected.length > 0,
      enabled: sync.data.provider_next.connected.length > 0,
      slash: {
        name: "disconnect",
      },
      onSelect: () => {
        dialog.replace(() => <DialogProviderDisconnect />)
      },
      category: "Provider",
    },
    {
      title: "Manage Account",
      value: "auth.manage",
      category: "Account",
      slash: {
        name: "auth",
        aliases: ["account"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogAuthManage />)
      },
    },
    {
      title: "Chat",
      value: "chat.open",
      category: "Account",
      slash: {
        name: "chat",
        aliases: ["messages", "dm"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogChat />)
      },
    },
    {
      title: "Settings",
      value: "settings.open",
      slash: { name: "settings" },
      onSelect: () => {
        dialog.replace(() => <DialogSettings />)
      },
      category: "System",
    },
    {
      title: "Run Brain",
      value: "brain.run",
      slash: { name: "brain" },
      onSelect: (dialog) => {
        const directory = sync.data.path.directory || sdk.directory || process.cwd()
        dialog.clear()
        toast.show({ message: "Brain started in background", variant: "info" })
        void (async () => {
          const { Brain } = await import("@/brain")
          const result = await withInstanceAsync({ directory }, () => Brain.trigger({ force: true }))
          if (!result.success) {
            toast.show({
              message: result.error ?? "Brain failed",
              variant: "error",
              duration: 5000,
            })
            return
          }

          toast.show({
            message: `Brain completed after reviewing ${result.sessionsReviewed} session${result.sessionsReviewed === 1 ? "" : "s"}`,
            variant: "success",
          })

          if (result.sessionID) {
            route.navigate({
              type: "session",
              sessionID: result.sessionID,
              workspaceID: sync.session.get(result.sessionID)?.workspaceID ?? route.data.workspaceID,
            })
          }
        })().catch((error) => {
          toast.show({
            message: error instanceof Error ? error.message : "Brain failed",
            variant: "error",
            duration: 5000,
          })
        })
      },
      category: "System",
    },
    {
      title: "Edit config",
      value: "config.edit",
      slash: { name: "config" },
      onSelect: () => {
        dialog.replace(() => <DialogConfig />)
      },
      category: "System",
    },
    {
      title: "Web preview",
      value: "web.preview",
      category: "Tools",
      slash: {
        name: "preview",
        aliases: ["browse", "web"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogWebPreview />)
      },
    },
    {
      title: "View status",
      keybind: "status_view",
      value: "nikcli.status",
      slash: {
        name: "status",
      },
      onSelect: () => {
        dialog.replace(() => <DialogStatus />)
      },
      category: "System",
    },
    {
      title: "Context usage",
      value: "nikcli.usage",
      slash: {
        name: "usage",
        aliases: ["context"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogUsage />)
      },
      category: "Session",
    },
    {
      title: "Analytics",
      value: "analytics.view",
      slash: {
        name: "analytics",
        aliases: ["stats"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogAnalytics onClose={() => dialog.clear()} />)
      },
      category: "Session",
    },
    {
      title: "Switch theme",
      value: "theme.switch",
      keybind: "theme_list",
      slash: {
        name: "themes",
      },
      onSelect: () => {
        dialog.replace(() => <DialogThemeList />)
      },
      category: "System",
    },
    {
      title: "Toggle appearance",
      value: "theme.switch_mode",
      onSelect: (dialog) => {
        setMode(mode() === "dark" ? "light" : "dark")
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Help",
      value: "help.show",
      slash: {
        name: "help",
      },
      onSelect: () => {
        dialog.replace(() => <DialogHelp />)
      },
      category: "System",
    },
    {
      title: "Open docs",
      value: "docs.open",
      onSelect: () => {
        open("https://nikcli.store/docs").catch(() => {})
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Open WebUI",
      value: "webui.open",
      onSelect: () => {
        open(sdk.url).catch(() => {})
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Exit the app",
      value: "app.exit",
      slash: {
        name: "exit",
        aliases: ["quit", "q"],
      },
      onSelect: () => exit(),
      category: "System",
    },
    {
      title: "Toggle debug panel",
      category: "System",
      value: "app.debug",
      onSelect: (dialog) => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: "Toggle console",
      category: "System",
      value: "app.console",
      onSelect: (dialog) => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
    {
      title: "Write heap snapshot",
      category: "System",
      value: "app.heap_snapshot",
      onSelect: (dialog) => {
        const path = writeHeapSnapshot()
        toast.show({
          variant: "info",
          message: `Heap snapshot written to ${path}`,
          duration: 5000,
        })
        dialog.clear()
      },
    },
    {
      title: "Suspend terminal",
      value: "terminal.suspend",
      keybind: "terminal_suspend",
      category: "System",
      hidden: true,
      onSelect: () => {
        const handler = () => {
          renderer.resume()
        }
        process.once("SIGCONT", handler)

        renderer.suspend()
        process.kill(0, "SIGTSTP")
      },
    },
    {
      title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
      value: "terminal.title.toggle",
      keybind: "terminal_title_toggle",
      category: "System",
      onSelect: (dialog) => {
        setTerminalTitleEnabled((prev) => {
          const next = !prev
          kv.set("terminal_title_enabled", next)
          if (!next) renderer.setTerminalTitle("")
          return next
        })
        dialog.clear()
      },
    },
  ])

  createEffect(
    on(
      () => local.model.current(),
      (currentModel) => {
        if (!currentModel) return
        if (currentModel.providerID === "openrouter" && !kv.get("openrouter_warning", false)) {
          untrack(() => {
            DialogAlert.show(
              dialog,
              "Warning",
              "While openrouter is a convenient way to access LLMs your request will often be routed to subpar providers that do not work well in our testing.\n\nFor reliable access to models check out Nikcli Zen\nhttps://nikcli.ai/zen",
            ).then(() => kv.set("openrouter_warning", true))
          })
        }
      },
      { defer: true },
    ),
  )

  onMount(() => {
    const unsubs = [
      sdk.event.on(TuiEvent.CommandExecute.type, (evt) => {
        command.trigger(evt.properties.command)
      }),
      sdk.event.on(TuiEvent.ToastShow.type, (evt) => {
        toast.show({
          title: evt.properties.title,
          message: evt.properties.message,
          variant: evt.properties.variant,
          duration: evt.properties.duration,
        })
      }),
      sdk.event.on("monitor.completed", (evt) => {
        const variant =
          evt.properties.status === "complete" ? "success" : evt.properties.status === "cancelled" ? "info" : "error"
        const exit = evt.properties.exitCode
        const suffix = exit === null ? "" : ` (exit ${exit})`
        toast.show({
          message: `${evt.properties.title} ${evt.properties.status}${suffix}`,
          variant,
          duration: evt.properties.status === "complete" ? 3500 : 5000,
        })
      }),
      sdk.event.on(TuiEvent.SessionSelect.type, (evt) => {
        route.navigate({
          type: "session",
          sessionID: evt.properties.sessionID,
          workspaceID: sync.session.get(evt.properties.sessionID)?.workspaceID,
        })
      }),
      sdk.event.on(SessionApi.Event.Deleted.type, (evt) => {
        const deletedSessionID = evt.properties.info.id
        const currentSessionID =
          route.data.type === "session" || route.data.type === "changes" || route.data.type === "tree"
            ? route.data.sessionID
            : undefined
        if (currentSessionID === deletedSessionID) {
          route.navigate({ type: "home", workspaceID: evt.properties.info.workspaceID })
          toast.show({
            variant: "info",
            message: "The current session was deleted",
          })
        }
      }),
      sdk.event.on(SessionApi.Event.Error.type, (evt) => {
        const error = evt.properties.error
        if (error && typeof error === "object" && error.name === "MessageAbortedError") return
        const sessionID = evt.properties.sessionID
        const currentSession = route.data.type === "session" ? route.data.sessionID : undefined
        const session = sessionID ? sync.session.get(sessionID) : undefined
        if (session?.title === BRAIN_SESSION_TITLE && currentSession !== sessionID) return
        const message = (() => {
          if (!error) return "An error occurred"

          if (typeof error === "object") {
            const data = error.data
            if ("message" in data && typeof data.message === "string") {
              return data.message
            }
          }
          return String(error)
        })()

        toast.show({
          variant: "error",
          message,
          duration: 5000,
        })
      }),
      sdk.event.on(Installation.Event.UpdateAvailable.type, (evt) => {
        toast.show({
          variant: "info",
          title: "Update Available",
          message: `Nikcli v${evt.properties.version} is available. Run 'nikcli upgrade' to update manually.`,
          duration: 10000,
        })
      }),
      sdk.event.on("permission.asked", () => {
        const tuiCfg = sync.data.config?.tui as { sound?: boolean } | undefined
        if (!tuiCfg?.sound) return
        Sound.pulse(1.3)
      }),
      sdk.event.on("session.idle", () => {
        const tuiCfg = sync.data.config?.tui as { sound?: boolean } | undefined
        if (!tuiCfg?.sound) return
        Sound.pulse(0.8)
      }),
    ]

    onCleanup(() => {
      unsubs.forEach((fn) => fn())
      Sound.dispose()
    })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseUp={async () => {
        if (Flag.NIKCLI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) {
          renderer.clearSelection()
          return
        }
        const text = renderer.getSelection()?.getSelectedText()
        if (text && text.length > 0) {
          await Clipboard.copy(text)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
          renderer.clearSelection()
        }
      }}
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
        <Match when={route.data.type === "changes" && route.data}>
          {(data) => <LegacyRedirect tab="changes" sessionID={data().sessionID} workspaceID={data().workspaceID} />}
        </Match>
        <Match when={route.data.type === "tree" && route.data}>
          {(data) => <LegacyRedirect tab="tree" sessionID={data().sessionID} workspaceID={data().workspaceID} />}
        </Match>
        <Match when={route.data.type === "git-graph" && route.data}>
          {(data) => <LegacyRedirect tab="graph" sessionID={data().sessionID} workspaceID={data().workspaceID} />}
        </Match>
        <Match when={route.data.type === "github" && route.data}>
          {(data) => <LegacyRedirect tab="github" sessionID={data().sessionID} workspaceID={data().workspaceID} />}
        </Match>
        <Match when={route.data.type === "workspace"}>
          <Workspace />
        </Match>
        <Match when={route.data.type === "plugin" && route.data}>
          {(data) => {
            pluginRouteKey()
            const entries = routes.get(data().id)
            const last = entries?.at(-1)
            return last ? (
              last.render({ params: data().data })
            ) : (
              <PluginRouteMissing id={data().id} onHome={() => route.navigate({ type: "home" })} />
            )
          }}
        </Match>
      </Switch>
      <StartupLoading ready={pluginsReady} />
    </box>
  )
}
