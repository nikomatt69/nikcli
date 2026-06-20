import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createMemo, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { createWorkspaceArchive } from "@/util/teleport-archive"

interface TeleportConfig {
  url?: string
  token?: string
}

interface ConfigWithTeleport {
  teleport?: TeleportConfig
}

/**
 * Normalize a user-entered server URL into a base origin we can append
 * `/mobile/teleport` to. Accepts values with or without a scheme/trailing slash.
 */
function normalizeBaseUrl(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    return url.origin + url.pathname.replace(/\/+$/, "").replace(/\/mobile(\/teleport)?$/, "")
  } catch {
    return null
  }
}

/**
 * Teleport the current session to a remote nikcli server (e.g. a Railway
 * deploy) so it can be resumed from the mobile app. The user supplies the
 * server URL and a mobile Bearer token; we ship the full transcript over.
 */
export function DialogTeleport(props: { sessionID: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  let urlInput: any
  let tokenInput: any

  const saved = () => (sync.data.config as ConfigWithTeleport | undefined)?.teleport

  const [store, setStore] = createStore({
    url: "",
    token: "",
    focus: "url" as "url" | "token",
    busy: false,
    status: "",
  })

  const sessionTitle = createMemo(() => sync.session.get(props.sessionID)?.title)

  onMount(() => {
    dialog.setSize("medium")
    const prev = saved()
    if (prev?.url) setStore("url", prev.url)
    if (prev?.token) setStore("token", prev.token)
    setTimeout(() => urlInput?.focus?.(), 1)
  })

  function focusField(field: "url" | "token") {
    setStore("focus", field)
    setTimeout(() => (field === "url" ? urlInput : tokenInput)?.focus?.(), 1)
  }

  async function teleport() {
    if (store.busy) return
    const base = normalizeBaseUrl(store.url)
    if (!base) {
      setStore("status", "Enter a valid server URL")
      return
    }
    const token = store.token.trim()
    if (!token) {
      setStore("status", "Enter a mobile auth token")
      focusField("token")
      return
    }

    setStore("busy", true)
    setStore("status", "Collecting session…")

    try {
      const [info, messages] = await Promise.all([
        sdk.client.session.get({ sessionID: props.sessionID }).then((x) => x.data),
        sdk.client.session.messages({ sessionID: props.sessionID }).then((x) => x.data ?? []),
      ])
      if (!info) {
        setStore("busy", false)
        setStore("status", "Could not load the current session")
        return
      }

      const payload = JSON.stringify({
        title: info.title,
        origin: sdk.directory,
        permission: info.permission,
        messages,
      })

      // Clone the working directory (working tree + .git, minus gitignored paths)
      // so the session is resumable with its content on the remote server.
      let archive: { path: string; cleanup: () => Promise<void> } | null = null
      if (info.directory) {
        setStore("status", "Archiving workspace…")
        archive = await createWorkspaceArchive(info.directory).catch(() => null)
      }

      setStore("status", `Teleporting ${messages.length} messages${archive ? " + workspace" : ""}…`)
      const init: RequestInit = { method: "POST", headers: { authorization: `Bearer ${token}` } }
      if (archive) {
        const form = new FormData()
        form.append("payload", payload)
        form.append("archive", Bun.file(archive.path), "workspace.tar.gz")
        init.body = form
      } else {
        ;(init.headers as Record<string, string>)["content-type"] = "application/json"
        init.body = payload
      }
      const response = await fetch(`${base}/mobile/teleport`, init).finally(() => void archive?.cleanup())

      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        setStore("busy", false)
        setStore(
          "status",
          response.status === 401
            ? "Unauthorized — check the auth token"
            : `Server error ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`,
        )
        return
      }

      const result = (await response.json().catch(() => null)) as { sessionID?: string; messageCount?: number } | null

      // Remember the server so the next teleport is one keystroke away.
      await sdk.client.config
        .update({ config: { teleport: { url: base, token } } as any })
        .catch(() => undefined)

      toast.show({
        message: result?.sessionID
          ? `Teleported to ${new URL(base).host} — open it on mobile`
          : "Session teleported",
        variant: "success",
      })
      dialog.clear()
    } catch (error) {
      setStore("busy", false)
      setStore("status", error instanceof Error ? error.message : "Failed to teleport session")
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      if (store.busy) return
      dialog.clear()
      return
    }
    if (evt.name === "tab") {
      if (store.busy) return
      focusField(store.focus === "url" ? "token" : "url")
      return
    }
    if (evt.name === "return") {
      if (store.busy) return
      if (store.focus === "url") {
        focusField("token")
        return
      }
      teleport()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={store.busy ? theme.textMuted : theme.text}>
          Teleport Session
        </text>
        <Show when={!store.busy}>
          <text fg={theme.textMuted}>tab switch · enter teleport · esc</text>
        </Show>
      </box>

      <text fg={theme.textMuted} wrapMode="word">
        Send "{sessionTitle() || "this session"}" to a remote server so you can continue it from the mobile app.
      </text>

      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.textMuted}>Server URL:</text>
        <box
          flexGrow={1}
          border={["bottom"]}
          borderColor={store.focus === "url" ? theme.primary : theme.borderSubtle}
          onMouseUp={() => focusField("url")}
        >
          <input
            value={store.url}
            onInput={(v) => {
              setStore("url", v)
              setStore("status", "")
            }}
            placeholder="https://my-app.up.railway.app"
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => (urlInput = r)}
          />
        </box>
      </box>

      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.textMuted}>Auth Token:</text>
        <box
          flexGrow={1}
          border={["bottom"]}
          borderColor={store.focus === "token" ? theme.primary : theme.borderSubtle}
          onMouseUp={() => focusField("token")}
        >
          <input
            value={store.token}
            onInput={(v) => {
              setStore("token", v)
              setStore("status", "")
            }}
            placeholder="mobile bearer token"
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => (tokenInput = r)}
          />
        </box>
      </box>

      <Show when={store.status}>
        <text fg={store.busy ? theme.textMuted : theme.warning} wrapMode="word">
          {store.status}
        </text>
      </Show>

      <box height={1} border={["top"]} borderColor={theme.borderSubtle} />

      <box flexDirection="row" justifyContent="flex-end" gap={1}>
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundElement} onMouseUp={() => dialog.clear()}>
          <text fg={theme.textMuted}>Cancel</text>
        </box>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={store.busy ? theme.backgroundElement : theme.primary}
          onMouseUp={() => !store.busy && teleport()}
        >
          <text fg={store.busy ? theme.textMuted : theme.selectedListItemText}>
            {store.busy ? "Teleporting…" : "Teleport"}
          </text>
        </box>
      </box>
    </box>
  )
}
