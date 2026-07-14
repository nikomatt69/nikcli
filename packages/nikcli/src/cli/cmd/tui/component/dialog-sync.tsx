import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useRemoteSync } from "@tui/context/remote-sync"
import { For, Show, createEffect, createMemo, on, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useToast } from "@tui/ui/toast"
import { FooterHint, FooterSep, FooterHintGroup } from "@tui/ui/footer-hints"

function formatAge(ts: number): string {
  const age = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (age < 60) return `${age}s ago`
  if (age < 3600) return `${Math.floor(age / 60)}m ago`
  return `${Math.floor(age / 3600)}h ago`
}

export function DialogSync() {
  const remote = useRemoteSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  let urlInput: any
  let tokenInput: any

  onMount(() => {
    dialog.setSize("large")
  })

  const status = () => remote.status
  const kind = createMemo(() => {
    if (!status().configured) return "unconfigured"
    if (status().connected) return "connected"
    if (status().lastError) return "error"
    return "disconnected"
  })
  const kindColor = createMemo(() => {
    const k = kind()
    if (k === "connected") return theme.success
    if (k === "error") return theme.error
    if (k === "disconnected") return theme.warning
    return theme.textMuted
  })
  const kindLabel = createMemo(() => {
    const k = kind()
    if (k === "connected") return "● connected"
    if (k === "error") return "✗ error"
    if (k === "disconnected") return "○ disconnected"
    return "— not configured"
  })

  const [form, setForm] = createStore({
    editing: false,
    url: "",
    token: "",
    focus: "url" as "url" | "token",
    busy: false,
    status: "",
  })

  const showForm = createMemo(() => form.editing || !status().configured)

  function focusField(field: "url" | "token") {
    setForm("focus", field)
    setTimeout(() => (field === "url" ? urlInput : tokenInput)?.focus?.(), 1)
  }

  createEffect(
    on(showForm, (visible) => {
      if (visible) focusField(form.focus)
    }),
  )

  function openEdit() {
    setForm("url", status().url ?? "")
    setForm("token", "")
    setForm("status", "")
    setForm("editing", true)
    focusField("url")
  }

  function closeForm() {
    setForm("editing", false)
    setForm("status", "")
  }

  async function save() {
    if (form.busy) return
    const url = form.url.trim()
    if (!url) {
      setForm("status", "Enter the hub URL")
      focusField("url")
      return
    }
    const token = form.token.trim()
    if (!token && !status().configured) {
      setForm("status", "Enter a cli-sync token (nikcli sync token create)")
      focusField("token")
      return
    }
    setForm("busy", true)
    setForm("status", "Saving…")
    const result = await remote.saveConfig({ url, token: token || undefined, autostart: true })
    setForm("busy", false)
    if (!result.ok) {
      setForm("status", result.error ?? "Save failed")
      return
    }
    toast.show({
      message: result.started ? "Sync hub saved — connected" : "Sync hub saved to global config",
      variant: "success",
    })
    if (result.error) setForm("status", `saved, but connect failed: ${result.error}`)
    else setForm("status", "")
    setForm("editing", false)
  }

  useKeyboard((evt) => {
    if (showForm()) {
      if (evt.name === "escape") {
        evt.preventDefault()
        if (form.busy) return
        if (form.editing) closeForm()
        else dialog.clear()
        return
      }
      if (evt.name === "tab") {
        evt.preventDefault()
        if (form.busy) return
        focusField(form.focus === "url" ? "token" : "url")
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        if (form.busy) return
        if (form.focus === "url") {
          focusField("token")
          return
        }
        void save()
        return
      }
      return
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
      return
    }
    if (evt.ctrl && evt.name === "e") {
      evt.preventDefault()
      openEdit()
      return
    }
    if (evt.ctrl && evt.name === "r") {
      evt.preventDefault()
      void remote.refresh()
      return
    }
    if (evt.ctrl && evt.name === "d") {
      evt.preventDefault()
      void remote.drain()
      return
    }
    if (evt.ctrl && evt.name === "c") {
      evt.preventDefault()
      if (remote.isConnected()) void remote.disconnect()
      else void remote.connect()
      return
    }
  })

  const bodyHeight = createMemo(() => Math.max(6, Math.min(28, dimensions().height - 12)))

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Sync
        </text>
        <text fg={kindColor()}>{kindLabel()}</text>
      </box>
      <text fg={theme.textMuted}>Unified event log for sessions + workspace, with optional hub-and-spoke remote</text>

      <Show
        when={!showForm()}
        fallback={
          <box
            backgroundColor={theme.backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            flexDirection="column"
            gap={1}
          >
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {form.editing ? "Edit sync server" : "Set up remote sync"}
            </text>
            <text fg={theme.textMuted} wrapMode="word">
              Saved to the global nikcli.json. NIKCLI_REMOTE_URL / NIKCLI_REMOTE_TOKEN env vars override it.
            </text>
            <Show when={status().source === "env"}>
              <text fg={theme.warning} wrapMode="word">
                Env vars are currently set and will keep overriding whatever you save here.
              </text>
            </Show>

            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted}>Server URL:</text>
              <box
                flexGrow={1}
                border={["bottom"]}
                borderColor={form.focus === "url" ? theme.primary : theme.borderSubtle}
                onMouseUp={() => focusField("url")}
              >
                <input
                  value={form.url}
                  onInput={(v) => {
                    setForm("url", v)
                    setForm("status", "")
                  }}
                  placeholder="https://s.nikcli.store"
                  cursorColor={theme.primary}
                  focusedTextColor={theme.text}
                  ref={(r: any) => (urlInput = r)}
                />
              </box>
            </box>

            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted}>Sync Token:</text>
              <box
                flexGrow={1}
                border={["bottom"]}
                borderColor={form.focus === "token" ? theme.primary : theme.borderSubtle}
                onMouseUp={() => focusField("token")}
              >
                <input
                  value={form.token}
                  onInput={(v) => {
                    setForm("token", v)
                    setForm("status", "")
                  }}
                  placeholder={
                    status().configured ? "leave blank to keep the current token" : "mobile or cli-sync bearer token"
                  }
                  cursorColor={theme.primary}
                  focusedTextColor={theme.text}
                  ref={(r: any) => (tokenInput = r)}
                />
              </box>
            </box>

            <Show when={form.status}>
              <text fg={form.busy ? theme.textMuted : theme.warning} wrapMode="word">
                {form.status}
              </text>
            </Show>

            <box flexDirection="row" justifyContent="space-between" alignItems="center">
              <text fg={theme.textMuted}>The local event log always works without the hub.</text>
              <box flexDirection="row" gap={1}>
                <Show when={form.editing}>
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundPanel}
                    onMouseUp={() => !form.busy && closeForm()}
                  >
                    <text fg={theme.textMuted}>Cancel</text>
                  </box>
                </Show>
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={form.busy ? theme.backgroundPanel : theme.primary}
                  onMouseUp={() => void save()}
                >
                  <text fg={form.busy ? theme.textMuted : theme.selectedListItemText}>
                    {form.busy ? "Saving…" : "Save"}
                  </text>
                </box>
              </box>
            </box>
          </box>
        }
      >
        <box flexDirection="row" gap={3} flexWrap="wrap">
          <Stat label="URL" value={status().url ?? "—"} />
          <Stat label="Source" value={status().source === "env" ? "env vars" : "config file"} />
          <Stat label="Outbox" value={`${status().pending} pending · ${status().failed} failed`} />
          <Stat label="Last seq" value={String(status().lastSeq)} />
          <Stat
            label="Last event"
            value={status().lastOrigin ? `${status().lastOrigin}` : "—"}
            color={status().lastOrigin === "remote" ? String(theme.accent) : undefined}
          />
        </box>

        <Show when={status().lastError}>
          <text fg={theme.error}>error: {status().lastError}</text>
        </Show>

        <box flexDirection="row" gap={2} paddingTop={1}>
          <ActionButton
            label={remote.isConnected() ? "Disconnect" : "Connect"}
            onClick={() => (remote.isConnected() ? remote.disconnect() : remote.connect())}
            accent={!remote.isConnected()}
          />
          <ActionButton label="Drain outbox" onClick={() => remote.drain()} disabled={status().pending === 0} />
          <ActionButton label="Refresh" onClick={() => remote.refresh()} />
          <ActionButton label="Settings" onClick={() => openEdit()} />
        </box>
      </Show>

      <text fg={theme.textMuted} paddingTop={1}>
        Recent events (newest first)
      </text>
      <scrollbox height={bodyHeight()} focused={!showForm()} scrollbarOptions={{ visible: true }}>
        <Show when={status().events.length > 0} fallback={<text fg={theme.textMuted}>No events yet.</text>}>
          <For each={status().events}>
            {(event) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted} wrapMode="none">
                  {formatAge(event.timestamp).padStart(8)}
                </text>
                <text
                  fg={
                    event.origin === "remote"
                      ? theme.accent
                      : event.aggregateKind === "workspace"
                        ? theme.primary
                        : theme.text
                  }
                  wrapMode="none"
                >
                  {event.origin === "remote" ? "↓" : "↑"}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  [{event.aggregateKind}]
                </text>
                <text fg={theme.text} wrapMode="none">
                  {event.type}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {event.preview && event.preview !== event.type ? ` ${event.preview}` : ""}
                </text>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>

      <box paddingTop={1} flexDirection="row" justifyContent="space-between">
        <FooterHintGroup>
          <FooterHint keys="esc" label={showForm() && form.editing ? "cancel" : "close"} />
          <FooterSep />
          <Show
            when={!showForm()}
            fallback={
              <>
                <FooterHint keys="tab" label="switch field" />
                <FooterSep />
                <FooterHint keys="enter" label="save" />
              </>
            }
          >
            <FooterHint keys="^c" label="connect" />
            <FooterSep />
            <FooterHint keys="^d" label="drain" />
            <FooterSep />
            <FooterHint keys="^r" label="refresh" />
            <FooterSep />
            <FooterHint keys="^e" label="settings" />
          </Show>
        </FooterHintGroup>
        <text fg={theme.textMuted}>
          {status().events.length} events · last seq {status().lastSeq}
        </text>
      </box>
    </box>
  )
}

function Stat(props: { label: string; value: string; color?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.textMuted} wrapMode="none">
        {props.label}
      </text>
      <text fg={props.color ?? theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
        {props.value}
      </text>
    </box>
  )
}

function ActionButton(props: { label: string; onClick: () => void; accent?: boolean; disabled?: boolean }) {
  const { theme } = useTheme()
  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={props.disabled ? theme.backgroundPanel : props.accent ? theme.primary : theme.backgroundElement}
      onMouseUp={() => {
        if (!props.disabled) props.onClick()
      }}
    >
      <text fg={props.disabled ? theme.textMuted : props.accent ? theme.selectedListItemText : theme.text}>
        {props.label}
      </text>
    </box>
  )
}
