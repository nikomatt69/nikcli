import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createSignal, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { Logo } from "../component/logo"
import { BgPulse, type BgPulseMask } from "../component/bg-pulse"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { useRemoteSync } from "../context/remote-sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import type { BoxRenderable } from "@opentui/core"
import { TuiPluginRuntime } from "../plugin"
export function Home() {
  const sync = useSync()
  const remote = useRemoteSync()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

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
    }
  })
  const directory = useDirectory()

  const keybind = useKeybind()

  const pulseEnabled = createMemo(() => {
    const tuiCfg = sync.data.config?.tui as { bg_pulse?: boolean } | undefined
    return Boolean(tuiCfg?.bg_pulse)
  })
  const [logoMask, setLogoMask] = createSignal<BgPulseMask | undefined>()
  const bindLogoBox = (box: BoxRenderable | undefined) => {
    if (!box) return
    const update = () => {
      setLogoMask({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        pad: 2,
        strength: 0.85,
      })
    }
    update()
    box.on("resize", update)
  }

  return (
    <>
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
        <box height={1} minHeight={0} flexShrink={1} />
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
        <TuiPluginRuntime.Slot name="home.bottom" />
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
                  <span
                    style={{
                      fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted,
                    }}
                  >
                    ⊙{" "}
                  </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
          <Show when={remote.isConfigured()}>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.text}>
              <span
                style={{
                  fg: remote.isConnected() ? theme.success : remote.status.lastError ? theme.error : theme.textMuted,
                }}
              >
                {remote.isConnected() ? "◉" : "○"}{" "}
              </span>
              {remote.status.pending > 0 ? `${remote.status.pending} pending` : "sync"}
            </text>
            <text fg={theme.textMuted}>/sync</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
      <TuiPluginRuntime.Slot name="home.footer" />
    </>
  )
}
