import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useTerminalDimensions } from "@opentui/solid"
import { Logo } from "../component/logo"
import { BgPulse, type BgPulseMask } from "../component/bg-pulse"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { DialogAgent } from "../component/dialog-agent"
import { useDialog } from "../ui/dialog"
import { TextAttributes, type BoxRenderable } from "@opentui/core"
const STARTER_CHIPS: Array<{ label: string; preview: string; text: string }> = [
  { label: "Explain", preview: "this codebase", text: "Explain this codebase in 5 lines" },
  { label: "Find", preview: "a TODO", text: "Find a TODO comment in the current directory and show it" },
  { label: "Fix", preview: "broken tests", text: "Run the tests and fix any failures" },
  { label: "Review", preview: "my changes", text: "Review my uncommitted git changes" },
]

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const routeCtrl = useRoute()
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const local = useLocal()
  const dialog = useDialog()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const ads = createMemo(() => sync.data.config.ads)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    // Show tips by default; respect the "tips_hidden" opt-out.
    return !tipsHidden()
  })
  const welcomeDismissed = createMemo(() => kv.get("welcome_dismissed", false))
  const showWelcome = createMemo(() => {
    return !welcomeDismissed() && sync.data.session.length === 0
  })
  const continueDismissed = createMemo(() => kv.get("continue_dismissed", false))
  /** Most recent session, if it was updated in the last 24h. */
  const recentSession = createMemo(() => {
    if (continueDismissed()) return undefined
    const top = local.session.mostRecent()
    if (!top) return undefined
    if (Date.now() - top.updated > 24 * 60 * 60 * 1000) return undefined
    return top
  })
  /** Show starter chips above the prompt for the very first sessions. */
  const showStarterChips = createMemo(() => sync.data.session.length < 3 && !kv.get("starter_chips_dismissed", false))

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      prompt.submit()
    } else if (local.agent.needsStarter() && sync.data.session.length === 0) {
      // First-time user: open the agent picker so they explicitly choose a starter.
      dialog.replace(() => <DialogAgent markStarterPicked />)
    }
  })
  const directory = useDirectory()

  const keybind = useKeybind()

  const pulseEnabled = createMemo(() => {
    const tuiCfg = sync.data.config?.tui as { bg_pulse?: boolean } | undefined
    return Boolean(tuiCfg?.bg_pulse)
  })
  const [logoMask, setLogoMask] = createSignal<BgPulseMask | undefined>()
  const dimensions = useTerminalDimensions()
  const tooSmall = createMemo(() => dimensions().width < 60 || dimensions().height < 20)
  const bindLogoBox = (box: BoxRenderable | undefined) => {
    if (!box) return
    const update = () => {
      setLogoMask({ x: box.x, y: box.y, width: box.width, height: box.height, pad: 2, strength: 0.85 })
    }
    update()
    box.on("resize", update)
  }

  return (
    <>
      <Show when={tooSmall()}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          alignItems="center"
          justifyContent="center"
          backgroundColor={theme.backgroundPanel}
          flexDirection="column"
          gap={1}
        >
          <text attributes={TextAttributes.BOLD} fg={theme.warning}>
            Terminal too small
          </text>
          <text fg={theme.text}>
            nikcli needs at least 60 columns × 20 rows. Current: {dimensions().width} × {dimensions().height}.
          </text>
          <text fg={theme.textMuted}>Please resize your window.</text>
        </box>
      </Show>
      <Show when={pulseEnabled()}>
        <box position="absolute" top={0} left={0} right={0} bottom={0} zIndex={-1}>
          <BgPulse masks={logoMask() ? [logoMask()!] : []} />
        </box>
      </Show>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box height={4} minHeight={0} flexShrink={1} />
        <box flexShrink={0} ref={bindLogoBox}>
          <Logo idle={true} />
        </box>
        <Show when={showWelcome()}>
          <box
            flexShrink={0}
            flexDirection="row"
            gap={1}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            borderColor={theme.primary}
          >
            <text fg={theme.text}>
              Welcome — first time here?{" "}
              <span style={{ fg: theme.accent }}>Run {keybind.print("command_list")} for the command palette</span>, or
              just type to start.
            </text>
            <box paddingLeft={1} paddingRight={1} onMouseUp={() => kv.set("welcome_dismissed", true)}>
              <text fg={theme.textMuted}>[dismiss]</text>
            </box>
          </box>
        </Show>
        <Show when={recentSession()}>
          <box
            flexShrink={0}
            flexDirection="row"
            gap={1}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            borderColor={theme.accent}
          >
            <text fg={theme.text}>
              <span style={{ fg: theme.accent }}>Continue where you left off:</span>{" "}
              {recentSession()!.title || "Untitled session"}
            </text>
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => {
                const s = recentSession()
                if (s) routeCtrl.navigate({ type: "session", sessionID: s.id })
              }}
            >
              <text fg={theme.text}>[open]</text>
            </box>
            <box paddingLeft={1} paddingRight={1} onMouseUp={() => kv.set("continue_dismissed", true)}>
              <text fg={theme.textMuted}>[dismiss]</text>
            </box>
          </box>
        </Show>
        <box height={1} minHeight={0} flexShrink={1} />
        <Show when={showStarterChips()}>
          <box
            flexShrink={0}
            flexDirection="row"
            gap={1}
            width="100%"
            maxWidth={75}
            paddingTop={1}
            paddingBottom={0}
            flexWrap="wrap"
          >
            <For each={STARTER_CHIPS}>
              {(chip) => (
                <box
                  paddingLeft={2}
                  paddingRight={2}
                  borderColor={theme.borderSubtle}
                  onMouseUp={() => {
                    if (prompt) {
                      prompt.set({ input: chip.text, parts: [] })
                      prompt.focus()
                    }
                  }}
                >
                  <text fg={theme.text}>
                    {chip.label} <span style={{ fg: theme.textMuted }}>{chip.preview}</span>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
            workspaceID={route.workspaceID}
          />
        </box>
        <box height={4} minHeight={0} width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
          <Show when={showTips()}>
            <Tips ads={ads()} />
          </Show>
        </box>
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        flexShrink={0}
        gap={2}
        alignItems="center"
        minWidth={0}
      >
        <text fg={theme.textMuted} wrapMode="none" flexShrink={1} minWidth={0}>
          {directory()}
        </text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
