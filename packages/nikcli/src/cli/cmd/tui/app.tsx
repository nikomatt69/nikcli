import { render, useRenderer, useTerminalDimensions } from "@opentui/solid"
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
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel, useConnected } from "@tui/component/dialog-model"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogConnectors } from "@tui/component/dialog-connectors"
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
import { DialogWorkspaceList } from "@tui/component/dialog-workspace-list"
import { DialogVariant } from "@tui/component/dialog-variant"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
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
import { Instance } from "@/project/instance"
import { TuiPluginRuntime, createTuiApi, type RouteMap } from "./plugin"
import { ErrorComponent } from "./component/error-component"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { StartupLoading } from "./component/startup-loading"
import { initBrainScheduler } from "@/brain/scheduler"
import { BRAIN_SESSION_TITLE } from "@/brain"
import { DialogWebPreview } from "@tui/component/dialog-web-preview"
import { UserDB } from "@/db/users"
import { DialogLogin } from "@tui/component/dialog-login"
import { DialogAuthManage } from "@tui/component/dialog-auth-manage"
import { DialogChat } from "@tui/component/dialog-chat"

async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  // can't set raw mode if not a TTY
  if (!process.stdin.isTTY) return "dark"

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      const match = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (match) {
        cleanup()
        const color = match[1]
        // Parse RGB values from color string
        // Formats: rgb:RR/GG/BB or #RRGGBB or rgb(R,G,B)
        let r = 0,
          g = 0,
          b = 0

        if (color.startsWith("rgb:")) {
          const parts = color.substring(4).split("/")
          r = parseInt(parts[0], 16) >> 8 // Convert 16-bit to 8-bit
          g = parseInt(parts[1], 16) >> 8 // Convert 16-bit to 8-bit
          b = parseInt(parts[2], 16) >> 8 // Convert 16-bit to 8-bit
        } else if (color.startsWith("#")) {
          r = parseInt(color.substring(1, 3), 16)
          g = parseInt(color.substring(3, 5), 16)
          b = parseInt(color.substring(5, 7), 16)
        } else if (color.startsWith("rgb(")) {
          const parts = color.substring(4, color.length - 1).split(",")
          r = parseInt(parts[0])
          g = parseInt(parts[1])
          b = parseInt(parts[2])
        }

        // Calculate luminance using relative luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

        // Determine if dark or light based on luminance threshold
        resolve(luminance > 0.5 ? "light" : "dark")
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")

    timeout = setTimeout(() => {
      cleanup()
      resolve("dark")
    }, 1000)
  })
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
    const mode = await getTerminalBackgroundColor()
    const tuiCfg = await TuiConfig.get().catch(() => ({}) as TuiConfig.Info)
    const onExit = async () => {
      await input.onExit?.()
      resolve()
    }

    render(
      () => {
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
      },
      {
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
      },
    )
  })
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

  onMount(() => {
    void (async () => {
      const storedToken = UserDB.getActiveSessionSync()
      const validUser = storedToken ? UserDB.verifySession(storedToken) : null
      if (!validUser) {
        await DialogLogin.run(dialog)
      }

      const tuiConfig = await Instance.provide({
        directory: sdk.directory || process.cwd(),
        fn: async () => {
          initBrainScheduler()
          return TuiConfig.get()
        },
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
    })()
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
        sessionID: route.data.type === "session" ? route.data.sessionID : null,
        title: route.data.type === "session" ? (sync.session.get(route.data.sessionID)?.title ?? null) : null,
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
          renderer.setTerminalTitle(`OC | ${title}`)
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
      title: "Manage connectors",
      value: "connectors.list",
      category: "Integrations",
      slash: {
        name: "connectors",
      },
      onSelect: () => {
        dialog.replace(() => <DialogConnectors />)
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
          const result = await Instance.provide({
            directory,
            fn: () => Brain.trigger({ force: true }),
          })
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
      title: "Tophat: install app",
      value: "tophat.install",
      category: "Mobile",
      slash: {
        name: "tophat",
        aliases: ["tophat-install", "install-app"],
      },
      onSelect: (dialog) => {
        dialog.clear()
        toast.show({
          message: "Use: install <path|url> [--platform ios|android] [--dest device|simulator]",
          variant: "info",
          duration: 6000,
        })
      },
    },
    {
      title: "Tophat: status",
      value: "tophat.status",
      category: "Mobile",
      slash: {
        name: "tophat-status",
      },
      onSelect: (dialog) => {
        dialog.clear()
        void (async () => {
          const { Tophat } = await import("@/mobile/tophat")
          const available = await Tophat.available()
          if (!available) {
            toast.show({ message: "Tophat not installed (macOS 15+ required)", variant: "error", duration: 5000 })
            return
          }
          const status = await Tophat.status()
          const devices =
            status.devices.map((d: { name: string; platform: string }) => `${d.name} (${d.platform})`).join(", ") ||
            "none"
          toast.show({
            message: `Tophat: ${status.providers.length} provider(s), devices: ${devices}`,
            variant: "info",
            duration: 6000,
          })
        })().catch((err: unknown) => {
          toast.show({
            message: err instanceof Error ? err.message : "Tophat status failed",
            variant: "error",
            duration: 4000,
          })
        })
      },
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
        if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
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
