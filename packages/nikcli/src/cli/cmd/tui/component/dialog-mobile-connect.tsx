import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { generateQRMatrix } from "@nikcli-ai/remote"
import { MobileAuth } from "@/mobile/auth"
import { buildMobilePairingDeepLink, getLocalIPs, isLoopbackHostname } from "@/cli/cmd/mobile"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useServer } from "@tui/context/server"
import { useToast } from "@tui/ui/toast"
import { Clipboard } from "@tui/util/clipboard"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createWorkspaceArchive, uploadWorkspaceArchive } from "@/util/teleport-archive"

function isPlainShortcut(evt: { ctrl?: boolean; meta?: boolean; super?: boolean; name?: string }, ...names: string[]) {
  return !evt.ctrl && !evt.meta && !evt.super && names.includes(evt.name ?? "")
}

type Pairing = {
  serverUrl: string
  urls: string[]
  token: string
  tokenID?: string
  deepLink: string
  matrix: boolean[][]
  expiresAt?: number
}

export type MobileDialogMode = "choose" | "cloud" | "local" | "teleport"

type RemoteServerConfig = {
  teleport?: {
    url?: string
    token?: string
  }
}

export function normalizeMobileServerUrl(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    const pathname = url.pathname.replace(/\/+$/, "").replace(/\/mobile(?:\/teleport)?$/, "")
    return `${url.origin}${pathname}`
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

function pairingUrls(baseUrl: string): string[] {
  const url = new URL(baseUrl)
  if (!isLoopbackHostname(url.hostname) && url.hostname !== "0.0.0.0" && url.hostname !== "::") {
    return [url.toString().replace(/\/$/, "")]
  }
  return getLocalIPs().map((ip) => {
    const host = ip.includes(":") ? `[${ip}]` : ip
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`
  })
}

function isLikelyIPhoneHotspotUrl(value: string): boolean {
  try {
    const octets = new URL(value).hostname.split(".").map(Number)
    return (
      octets.length === 4 &&
      octets[0] === 172 &&
      octets[1] === 20 &&
      octets[2] === 10 &&
      (octets[3] ?? 0) >= 2 &&
      (octets[3] ?? 0) <= 14
    )
  } catch {
    return false
  }
}

export function renderQRRows(matrix: boolean[][], margin = 1): string[] {
  if (matrix.length === 0) return []
  const width = matrix[0]?.length ?? 0
  const blank = Array(width + margin * 2).fill(false) as boolean[]
  const padded = [
    ...Array.from({ length: margin }, () => [...blank]),
    ...matrix.map((row) => [...Array(margin).fill(false), ...row, ...Array(margin).fill(false)] as boolean[]),
    ...Array.from({ length: margin }, () => [...blank]),
  ]
  if (padded.length % 2 !== 0) padded.push([...blank])

  const rows: string[] = []
  for (let row = 0; row < padded.length; row += 2) {
    let value = ""
    for (let column = 0; column < blank.length; column++) {
      const top = padded[row]?.[column] ?? false
      const bottom = padded[row + 1]?.[column] ?? false
      value += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " "
    }
    rows.push(value)
  }
  return rows
}

function qrRenderWidth(matrix: boolean[][], margin = 1): number {
  return (matrix[0]?.length ?? 0) + margin * 2 + 2
}

function QRCode(props: { matrix: boolean[][] }) {
  const { theme } = useTheme()
  const rows = createMemo(() => renderQRRows(props.matrix))
  return (
    <box backgroundColor={theme.text} paddingLeft={1} paddingRight={1} flexDirection="column">
      <For each={rows()}>
        {(row) => (
          <text fg={theme.background} bg={theme.text} wrapMode="none">
            {row}
          </text>
        )}
      </For>
    </box>
  )
}

export function DialogMobileConnect(props: { sessionID?: string; initialMode?: MobileDialogMode }) {
  const [mode, setMode] = createSignal<MobileDialogMode>(props.initialMode ?? "choose")

  const options = createMemo<DialogSelectOption<MobileDialogMode>[]>(() => [
    {
      title: "Connect cloud server",
      value: "cloud",
      description: "Enter a remote nikcli server URL and mobile auth token, then scan its QR code.",
    },
    {
      title: "Connect local server",
      value: "local",
      description: "Start a protected LAN server and create a mobile pairing token automatically.",
    },
    {
      title: "Teleport session",
      value: "teleport",
      description: props.sessionID
        ? "Send the current session and workspace to a remote nikcli server."
        : "Open this dialog from an active session to use Teleport.",
      disabled: !props.sessionID,
    },
  ])

  return (
    <Show
      when={mode() !== "choose"}
      fallback={
        <DialogSelect
          title="Connect Nikcli Mobile"
          options={options()}
          onSelect={(option) => {
            if (!option.disabled) setMode(option.value)
          }}
        />
      }
    >
      <Show when={mode() === "local"}>
        <LocalMobileConnect onBack={() => setMode("choose")} />
      </Show>
      <Show when={mode() === "cloud"}>
        <RemoteServerPanel mode="cloud" onBack={() => setMode("choose")} />
      </Show>
      <Show when={mode() === "teleport" && props.sessionID}>
        <RemoteServerPanel mode="teleport" sessionID={props.sessionID} onBack={() => setMode("choose")} />
      </Show>
    </Show>
  )
}

function RemoteServerPanel(props: { mode: "cloud" | "teleport"; sessionID?: string; onBack: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  let urlInput: any
  let tokenInput: any

  const [pairing, setPairing] = createSignal<Pairing>()
  const [form, setForm] = createStore({
    url: "",
    token: "",
    focus: "url" as "url" | "token",
    busy: false,
    status: "",
  })
  const qrRows = createMemo(() => (pairing() ? renderQRRows(pairing()!.matrix).length : 0))
  const qrWidth = createMemo(() => (pairing() ? qrRenderWidth(pairing()!.matrix) : 0))
  const stacked = createMemo(() => dimensions().width < qrWidth() + 50)

  onMount(() => {
    dialog.setSize(dimensions().width >= 100 ? "xlarge" : "large")
    const saved = (sync.data.config as RemoteServerConfig | undefined)?.teleport
    if (saved?.url) setForm("url", saved.url)
    if (saved?.token) setForm("token", saved.token)
    setTimeout(() => urlInput?.focus?.(), 1)
  })

  function focusField(field: "url" | "token") {
    setForm("focus", field)
    setTimeout(() => (field === "url" ? urlInput : tokenInput)?.focus?.(), 1)
  }

  async function saveRemoteServer(url: string, token: string) {
    await sdk.client.config.update({ config: { teleport: { url, token } } as any }).catch(() => undefined)
  }

  async function connectCloud() {
    if (form.busy) return
    const base = normalizeMobileServerUrl(form.url)
    if (!base) {
      setForm("status", "Enter a valid HTTP or HTTPS server URL")
      focusField("url")
      return
    }
    const token = form.token.trim()
    if (!token) {
      setForm("status", "Enter a mobile auth token")
      focusField("token")
      return
    }

    setForm("busy", true)
    setForm("status", "Verifying server and mobile token…")
    try {
      const response = await fetch(`${base}/mobile/auth/token`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Unauthorized — use a mobile-scoped auth token"
            : `Server error ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`,
        )
      }

      const deepLink = buildMobilePairingDeepLink({
        serverUrl: base,
        token,
      })
      const matrix = await generateQRMatrix(deepLink)
      if (!matrix) throw new Error("QR generation is unavailable")
      await saveRemoteServer(base, token)
      setPairing({
        serverUrl: base,
        urls: [base],
        token,
        deepLink,
        matrix,
      })
      setForm("url", base)
      setForm("status", "Server verified — scan with the Nikcli mobile app")
    } catch (cause) {
      setForm("status", cause instanceof Error ? cause.message : String(cause))
    } finally {
      setForm("busy", false)
    }
  }

  async function teleport() {
    if (form.busy || !props.sessionID) return
    const base = normalizeMobileServerUrl(form.url)
    if (!base) {
      setForm("status", "Enter a valid HTTP or HTTPS server URL")
      focusField("url")
      return
    }
    const token = form.token.trim()
    if (!token) {
      setForm("status", "Enter a mobile auth token")
      focusField("token")
      return
    }

    setForm("busy", true)
    setForm("status", "Collecting session…")
    try {
      const [info, messages] = await Promise.all([
        sdk.client.session.get({ sessionID: props.sessionID }).then((response) => response.data),
        sdk.client.session.messages({ sessionID: props.sessionID }).then((response) => response.data ?? []),
      ])
      if (!info) throw new Error("Could not load the current session")

      let uploadID: string | undefined
      if (info.directory) {
        setForm("status", "Archiving workspace…")
        const archive = await createWorkspaceArchive(info.directory).catch(() => null)
        if (archive) {
          const size = formatBytes(archive.bytes)
          try {
            uploadID = await uploadWorkspaceArchive({
              base,
              token,
              archivePath: archive.path,
              onProgress: (sent, total) => {
                const percent = total ? Math.floor((sent / total) * 100) : 100
                setForm("status", `Uploading workspace ${size}… ${percent}%`)
              },
            })
          } finally {
            await archive.cleanup()
          }
        }
      }

      setForm("status", `Teleporting ${messages.length} messages${uploadID ? " + workspace" : ""}…`)
      const response = await fetch(`${base}/mobile/teleport`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: info.title,
          name: info.directory ? info.directory.split(/[\\/]/).filter(Boolean).pop() : undefined,
          origin: sdk.directory,
          permission: info.permission,
          messages,
          uploadID,
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Unauthorized — use a mobile-scoped auth token"
            : `Server error ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`,
        )
      }

      const result = (await response.json().catch(() => null)) as {
        sessionID?: string
      } | null
      await saveRemoteServer(base, token)
      toast.show({
        message: result?.sessionID ? `Teleported to ${new URL(base).host} — open it on mobile` : "Session teleported",
        variant: "success",
      })
      dialog.clear()
    } catch (cause) {
      setForm("status", cause instanceof Error ? cause.message : "Failed to teleport session")
    } finally {
      setForm("busy", false)
    }
  }

  async function submit() {
    if (props.mode === "cloud") await connectCloud()
    else await teleport()
  }

  async function copyDeepLink() {
    const value = pairing()?.deepLink
    if (!value) return
    await Clipboard.copy(value)
      .then(() => toast.show({ message: "Mobile link copied", variant: "success" }))
      .catch(toast.error)
  }

  useKeyboard((event) => {
    if (event.name === "escape") {
      if (form.busy) return
      props.onBack()
      return
    }
    if (pairing()) {
      if (isPlainShortcut(event, "y")) {
        event.preventDefault()
        void copyDeepLink()
      }
      if (isPlainShortcut(event, "r")) {
        event.preventDefault()
        setPairing(undefined)
        setForm("status", "")
        focusField("url")
      }
      return
    }
    if (event.name === "tab") {
      event.preventDefault()
      focusField(form.focus === "url" ? "token" : "url")
      return
    }
    if (event.name === "return") {
      event.preventDefault()
      if (form.focus === "url") focusField("token")
      else void submit()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.mode === "cloud" ? "Connect cloud server" : "Teleport session"}
        </text>
        <text fg={theme.textMuted}>esc back</text>
      </box>

      <Show
        when={pairing()}
        fallback={
          <>
            <text fg={theme.textMuted} wrapMode="word">
              {props.mode === "cloud"
                ? "Use a mobile-scoped Bearer token from the remote nikcli server. Remote-sync tokens are not valid here."
                : "Send the current session and workspace to a remote nikcli server."}
            </text>
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
                  onInput={(value) => {
                    setForm("url", value)
                    setForm("status", "")
                  }}
                  placeholder="https://my-nikcli-server.example.com"
                  cursorColor={theme.primary}
                  focusedTextColor={theme.text}
                  ref={(value) => (urlInput = value)}
                />
              </box>
            </box>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted}>Auth token:</text>
              <box
                flexGrow={1}
                border={["bottom"]}
                borderColor={form.focus === "token" ? theme.primary : theme.borderSubtle}
                onMouseUp={() => focusField("token")}
              >
                <input
                  value={form.token}
                  onInput={(value) => {
                    setForm("token", value)
                    setForm("status", "")
                  }}
                  placeholder="nkm_…"
                  cursorColor={theme.primary}
                  focusedTextColor={theme.text}
                  ref={(value) => (tokenInput = value)}
                />
              </box>
            </box>
            <Show when={form.status}>
              <text fg={form.busy ? theme.textMuted : theme.warning} wrapMode="word">
                {form.status}
              </text>
            </Show>
            <box marginTop={1} flexDirection="row" justifyContent="flex-end" gap={1}>
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={form.busy ? theme.backgroundElement : theme.primary}
                onMouseUp={() => !form.busy && void submit()}
              >
                <text fg={form.busy ? theme.textMuted : theme.selectedListItemText}>
                  {form.busy
                    ? props.mode === "cloud"
                      ? "Verifying…"
                      : "Teleporting…"
                    : props.mode === "cloud"
                      ? "Create QR"
                      : "Teleport"}
                </text>
              </box>
            </box>
          </>
        }
      >
        {(value) => (
          <>
            <text fg={theme.success}>{form.status}</text>
            <box flexDirection={stacked() ? "column" : "row"} gap={2} alignItems={stacked() ? "center" : "flex-start"}>
              <box flexDirection="column" gap={1} flexGrow={1} minWidth={32}>
                <text attributes={TextAttributes.BOLD} fg={theme.primary}>
                  Scan from Nikcli Mobile
                </text>
                <text fg={theme.textMuted} wrapMode="word">
                  This QR connects the app directly to the verified cloud server.
                </text>
                <text fg={theme.textMuted}>Server URL</text>
                <text fg={theme.accent} selectable wrapMode="word">
                  {value().serverUrl}
                </text>
                <text fg={theme.textMuted}>Pairing token</text>
                <text fg={theme.text}>{value().token.slice(0, 8)}••••••••••••••••</text>
              </box>
              <scrollbox
                height={Math.min(qrRows(), Math.max(8, dimensions().height - 12))}
                width={qrWidth()}
                scrollbarOptions={{
                  visible: stacked() && qrRows() > dimensions().height - 12,
                }}
              >
                <QRCode matrix={value().matrix} />
              </scrollbox>
            </box>
            <box flexDirection="row" gap={2} marginTop={1}>
              <text fg={theme.textMuted}>y copy link</text>
              <text fg={theme.textMuted}>r edit server</text>
              <text fg={theme.textMuted}>esc back</text>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}

function LocalMobileConnect(props: { onBack: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const server = useServer()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const [pairing, setPairing] = createSignal<Pairing>()
  const [selectedURL, setSelectedURL] = createSignal(0)
  const [status, setStatus] = createSignal("Preparing a secure mobile link…")
  const [error, setError] = createSignal<string>()
  const [connected, setConnected] = createSignal(false)
  let activityTimer: ReturnType<typeof setInterval> | undefined

  const qrRows = createMemo(() => (pairing() ? renderQRRows(pairing()!.matrix).length : 0))
  const qrWidth = createMemo(() => (pairing() ? qrRenderWidth(pairing()!.matrix) : 0))
  const stacked = createMemo(() => dimensions().width < qrWidth() + 50)

  onMount(() => {
    dialog.setSize(dimensions().width >= 100 ? "xlarge" : "large")
    void createPairing()
  })

  onCleanup(() => {
    if (activityTimer) clearInterval(activityTimer)
  })

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onBack()
      return
    }
    if (event.name === "tab" && (pairing()?.urls.length ?? 0) > 1) {
      event.preventDefault()
      void selectURL((selectedURL() + 1) % pairing()!.urls.length)
      return
    }
    if (isPlainShortcut(event, "y")) {
      event.preventDefault()
      void copyDeepLink()
      return
    }
    if (isPlainShortcut(event, "r")) {
      event.preventDefault()
      void createPairing()
    }
  })

  async function resolveBaseUrl() {
    if (!server.startServer || !server.createMobileToken)
      throw new Error("Start nikcli with --hostname 0.0.0.0 to connect from your phone")
    setStatus("Starting a token-protected LAN server…")
    return server.startServer({
      hostname: "0.0.0.0",
      port: 0,
      mdns: true,
      mobileAuthRequired: true,
    })
  }

  async function createPairing() {
    setError(undefined)
    setConnected(false)
    setStatus("Preparing a secure mobile link…")
    try {
      const createMobileToken = server.createMobileToken
      if (!createMobileToken) {
        throw new Error("This TUI cannot create a token for the local server")
      }
      const baseUrl = await resolveBaseUrl()
      const urls = pairingUrls(baseUrl)
      if (urls.length === 0) {
        throw new Error("No LAN address found. Connect both devices to the same network or use a public server URL.")
      }
      const created = await createMobileToken({
        name: "mobile-app",
        expiresInDays: 90,
      })
      const serverUrl = urls[0]!
      const deepLink = buildMobilePairingDeepLink({
        serverUrl,
        token: created.token,
        directory: sdk.directory,
      })
      const matrix = await generateQRMatrix(deepLink)
      if (!matrix) throw new Error("QR generation is unavailable")
      setSelectedURL(0)
      setPairing({
        serverUrl,
        urls,
        token: created.token,
        tokenID: created.info.id,
        deepLink,
        matrix,
        expiresAt: created.info.expiresAt,
      })
      setStatus("Scan the QR code with the Nikcli mobile app")
      watchConnection(created.info.id)
    } catch (cause) {
      setPairing(undefined)
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus("Could not create the mobile link")
    }
  }

  async function selectURL(index: number) {
    const current = pairing()
    if (!current) return
    const serverUrl = current.urls[index]
    if (!serverUrl) return
    const deepLink = buildMobilePairingDeepLink({
      serverUrl,
      token: current.token,
      directory: sdk.directory,
    })
    const matrix = await generateQRMatrix(deepLink)
    if (!matrix) return
    setSelectedURL(index)
    setPairing({ ...current, serverUrl, deepLink, matrix })
  }

  function watchConnection(tokenID: string) {
    if (activityTimer) clearInterval(activityTimer)
    activityTimer = setInterval(() => {
      void MobileAuth.list().then((tokens) => {
        const token = tokens.find((item) => item.id === tokenID)
        if (!token?.lastUsedAt) return
        setConnected(true)
        setStatus("Mobile app connected")
      })
    }, 1000)
  }

  async function copyDeepLink() {
    const value = pairing()?.deepLink
    if (!value) return
    await Clipboard.copy(value)
      .then(() => toast.show({ message: "Mobile link copied", variant: "success" }))
      .catch(toast.error)
  }

  return (
    <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Connect local server
        </text>
        <text fg={theme.textMuted}>esc back</text>
      </box>
      <text fg={connected() ? theme.success : error() ? theme.error : theme.textMuted}>{status()}</text>

      <Show when={error()}>
        <box backgroundColor={theme.backgroundElement} padding={1} flexDirection="column" gap={1}>
          <text fg={theme.error} wrapMode="word">
            {error()}
          </text>
          <text fg={theme.textMuted}>Press r to try again.</text>
        </box>
      </Show>

      <Show when={pairing()}>
        {(value) => (
          <box flexDirection={stacked() ? "column" : "row"} gap={2} alignItems={stacked() ? "center" : "flex-start"}>
            <box flexDirection="column" gap={1} flexGrow={1} minWidth={32}>
              <text attributes={TextAttributes.BOLD} fg={theme.primary}>
                Scan from Nikcli Mobile
              </text>
              <text fg={theme.textMuted} wrapMode="word">
                The QR securely pairs this server and workspace. It enables mobile sessions, approvals, remote actions
                and Teleport workflows.
              </text>
              <box marginTop={1} flexDirection="column">
                <text fg={theme.textMuted}>Server URL</text>
                <text fg={theme.accent} selectable wrapMode="word">
                  {value().serverUrl}
                </text>
              </box>
              <Show when={value().urls.length > 1}>
                <text fg={theme.textMuted}>
                  tab switches network interface ({selectedURL() + 1}/{value().urls.length})
                </text>
              </Show>
              <Show when={isLikelyIPhoneHotspotUrl(value().serverUrl)}>
                <text fg={theme.warning} wrapMode="word">
                  iPhone Personal Hotspot may block access from the phone to connected devices. Use the same Wi-Fi
                  network, Tailscale, or the cloud server if this connection times out.
                </text>
              </Show>
              <box marginTop={1} flexDirection="column">
                <text fg={theme.textMuted}>Pairing token</text>
                <text fg={theme.text}>{value().token.slice(0, 8)}••••••••••••••••</text>
              </box>
              <text fg={theme.textMuted}>
                Expires {value().expiresAt ? new Date(value().expiresAt!).toLocaleDateString() : "never"}
              </text>
              <Show when={connected()}>
                <text attributes={TextAttributes.BOLD} fg={theme.success}>
                  ● Connected
                </text>
              </Show>
            </box>
            <scrollbox
              height={Math.min(qrRows(), Math.max(8, dimensions().height - 12))}
              width={qrWidth()}
              scrollbarOptions={{
                visible: stacked() && qrRows() > dimensions().height - 12,
              }}
            >
              <QRCode matrix={value().matrix} />
            </scrollbox>
          </box>
        )}
      </Show>

      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={theme.textMuted}>y copy link</text>
        <text fg={theme.textMuted}>r new token</text>
        <Show when={(pairing()?.urls.length ?? 0) > 1}>
          <text fg={theme.textMuted}>tab next interface</text>
        </Show>
        <text fg={theme.textMuted}>esc back</text>
      </box>
    </box>
  )
}
