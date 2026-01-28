import { createMemo, createSignal, Show, For, createEffect, onCleanup } from "solid-js"
import { pipe } from "remeda"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import {
  checkTunnelAvailability,
  createTunnel,
  connectToTerminal,
  generateQR,
  probeTunnel,
  type TunnelProvider,
  type TerminalConnection,
  type TunnelResult,
} from "@nikcli-ai/remote"
import { remoteService, type RemoteSession } from "@/cli/remote"

interface RemoteConfig {
  enableTunnel?: boolean
  provider?: string
}

interface ConfigWithRemote {
  remote?: RemoteConfig
}

interface Device {
  id: string
  name: string
  connectedAt: Date
}

function parseQRGrid(qrText: string): boolean[][] {
  const lines = qrText.split("\n").filter((l) => l.trim())
  const grid: boolean[][] = []
  for (const line of lines) {
    const row: boolean[] = []
    for (const char of line) {
      if (char === " " || char === "░" || char === "▒") {
        row.push(false)
      } else if (char === "█" || char === "▀" || char === "▄") {
        row.push(true)
      }
    }
    if (row.length > 0) grid.push(row)
  }
  return grid
}

function QRCodeDisplay({ qrText }: { qrText: string }) {
  const grid = createMemo(() => parseQRGrid(qrText))

  return (
    <box flexDirection="column" marginLeft={1}>
      <For each={grid().slice(0, 21)}>
        {(row) => (
          <box>
            <For each={row.slice(0, 21)}>{(cell) => <text fg={cell ? "white" : "gray"}>{cell ? "█" : "░"}</text>}</For>
          </box>
        )}
      </For>
    </box>
  )
}

function TerminalView({ connection }: { connection: TerminalConnection }) {
  const [output, setOutput] = createSignal<string[]>([
    "Connected to NikCLI remote terminal",
    "Type 'q' to disconnect",
    "",
  ])
  const [input, setInput] = createSignal("")

  createEffect(() => {
    const run = async () => {
      for await (const chunk of connection.output) {
        setOutput((prev) => [...prev, chunk])
      }
    }
    run()
  })

  const handleKey = (key: string) => {
    if (key === "\r") {
      connection.write(input() + "\n")
      setOutput((prev) => [...prev, `> ${input()}`])
      setInput("")
    } else if (key === "\x7f") {
      setInput((prev) => prev.slice(0, -1))
    } else if (key === "q") {
      connection.close()
    } else if (key.length === 1) {
      setInput((prev) => prev + key)
    }
  }

  return (
    <box flexDirection="column">
      <box border={["top", "bottom", "left", "right"]} borderColor="blue" padding={1} flexGrow={1}>
        <box flexDirection="column">
          <For each={output().slice(-30)}>{(line) => <text fg="white">{line}</text>}</For>
        </box>
      </box>
      <box marginTop={1}>
        <text fg="gray">{"> "}</text>
        <text fg="white">{input()}</text>
        <text fg="gray">_</text>
      </box>
      <text fg="gray" marginTop={1}>
        Press keys to type, Enter to send, 'q' to disconnect
      </text>
    </box>
  )
}

export function DialogRemote() {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const renderer = useRenderer()
  const [ref, setRef] = createSignal<DialogSelectRef<{ providerID: string }>>()
  const [query, setQuery] = createSignal("")
  const [qrData, setQrData] = createSignal<string>("")
  const [sessionInfo, setSessionInfo] = createSignal<{ url: string; localUrl: string; port: number } | null>(null)
  const [isStarting, setIsStarting] = createSignal(false)
  const [devices, setDevices] = createSignal<Device[]>([])
  const [terminalConnection, setTerminalConnection] = createSignal<TerminalConnection | null>(null)
  const [tunnel, setTunnel] = createSignal<TunnelResult | null>(null)
  let cleanupListeners: (() => void) | null = null
  let detachRendererBridge: (() => void) | null = null

  const currentRemote = () => (sync.data.config as ConfigWithRemote | undefined)?.remote

  const providers = [
    { id: "localtunnel", name: "Localtunnel", description: "Quick tunnel via localtunnel.me" },
    { id: "cloudflared", name: "Cloudflared", description: "Cloudflare tunnel (requires cloudflared CLI)" },
    { id: "ngrok", name: "Ngrok", description: "Ngrok tunnel (requires ngrok auth token)" },
    { id: "remotosh", name: "Remotosh", description: "Remotosh tunnel (requires remotosh CLI)" },
    { id: "none", name: "Local Only", description: "No tunnel - use local network IP" },
  ]

  onCleanup(() => {
    cleanupListeners?.()
    cleanupListeners = null
    detachRendererBridge?.()
    detachRendererBridge = null
  })

  const startRemoteSession = async () => {
    setIsStarting(true)
    try {
      if (!remoteService.isInitialized()) {
        await remoteService.init()
      }

      if (remoteService.hasActiveSession()) {
        const existing = remoteService.getSession()
        if (existing) {
          syncSessionInfo(existing)
        }
        toast.show({ message: "Remote session already active", variant: "info" })
        return
      }

      const enableTunnel = currentRemote()?.enableTunnel ?? true
      const configuredProvider = currentRemote()?.provider as TunnelProvider | undefined
      const tunnelProvider = configuredProvider || "localtunnel"
      const useTunnel = enableTunnel && tunnelProvider !== "none"
      const session = await remoteService.startSession()
      attachRendererBridge()
      renderer.requestRender()
      let sessionUrl = buildSessionUrl(session, session.localUrl || session.qrUrl)

      if (useTunnel) {
        const providers = await (async () => {
          if (configuredProvider) return [tunnelProvider]

          const candidates: TunnelProvider[] = ["localtunnel", "cloudflared", "ngrok", "remotosh"]
          const available: TunnelProvider[] = []

          for (const candidate of candidates) {
            if (await checkTunnelAvailability(candidate)) {
              available.push(candidate)
            }
          }

          if (!available.includes(tunnelProvider)) return available

          return [tunnelProvider, ...available.filter((candidate) => candidate !== tunnelProvider)]
        })()

        if (providers.length === 0) {
          toast.show({ message: "No tunnel providers available; using local network only", variant: "warning" })
        }

        if (providers.length > 0) {
          const port = session.port ?? remoteService.getServerPort()
          if (!port) {
            toast.show({ message: "Tunnel unavailable; missing server port", variant: "error" })
          }

          if (port) {
            for (const provider of providers) {
              const result = await createTunnel(port, provider).catch((error) => {
                const message = error instanceof Error ? error.message : String(error)
                toast.show({ message: `Tunnel failed (${provider}): ${message}`, variant: "error" })
                return null
              })

              if (!result) continue

              const url = buildSessionUrl(session, result.url)
              const ok = await probeTunnel(url)
              if (!ok) {
                await result.close().catch(() => {})
                toast.show({ message: `Tunnel unreachable (${provider})`, variant: "warning" })
                continue
              }

              setTunnel(result)
              session.tunnelUrl = url
              sessionUrl = url
              break
            }
          }
        }
      }

      session.qrUrl = sessionUrl
      syncSessionInfo(session)
      try {
        attachRemoteListeners()
      } catch (e) {
        console.error("Failed to attach remote listeners:", e)
        toast.show({ message: "Session started but listener attachment failed", variant: "warning" })
      }

      toast.show({ message: "Remote session started", variant: "success" })
    } catch (e) {
      stopRemoteSession({ silent: true })
      toast.show({ message: `Failed to start remote session: ${e}`, variant: "error" })
    } finally {
      setIsStarting(false)
    }
  }

  const stopRemoteSession = (options: { silent?: boolean } = {}) => {
    if (terminalConnection()) {
      terminalConnection()!.close()
      setTerminalConnection(null)
    }
    detachRendererBridge?.()
    detachRendererBridge = null
    if (tunnel()) {
      void tunnel()!
        .close()
        .catch(() => {})
      setTunnel(null)
    }
    if (remoteService.hasActiveSession()) {
      remoteService.stopSession().catch(() => {})
    }
    setQrData("")
    setSessionInfo(null)
    setDevices([])
    cleanupListeners?.()
    cleanupListeners = null
    if (!options.silent) {
      toast.show({ message: "Remote session stopped", variant: "info" })
    }
  }

  const viewDeviceTerminal = async (device: Device) => {
    const info = sessionInfo()
    if (!info?.localUrl) return

    try {
      const secret = remoteService.getSessionSecret()
      const wsUrl = buildWsUrl(info)
      const conn = await connectToTerminal(wsUrl, secret)
      setTerminalConnection(conn)
      toast.show({ message: "Terminal connected", variant: "success" })
    } catch (e) {
      toast.show({ message: `Failed to connect to device: ${e}`, variant: "error" })
    }
  }

  const options = createMemo(() => {
    const q = query().trim().toLowerCase()
    const needle = q

    const allOptions = [
      {
        value: { action: "start" },
        title: qrData() ? "Stop Remote Session" : "Start Remote Session",
        description: qrData() ? "Session active" : "Start server and show QR code",
        category: "Remote",
        disabled: isStarting(),
        onSelect: async () => {
          if (qrData()) {
            stopRemoteSession()
          } else {
            await startRemoteSession()
          }
        },
      },
      ...devices().map((device) => ({
        value: { deviceID: device.id },
        title: device.name,
        description: `Connected at ${device.connectedAt.toLocaleTimeString()}`,
        category: "Devices",
        onSelect: () => viewDeviceTerminal(device),
      })),
      ...pipe(
        providers,
        (providers) =>
          providers.filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.id.includes(needle)),
        (providers) =>
          providers.map((provider) => {
            const isCurrent = provider.id === currentRemote()?.provider
            return {
              value: { providerID: provider.id },
              title: provider.name,
              description: provider.description,
              category: "Tunnel Provider",
              disabled: isCurrent,
              onSelect: async () => {
                const { error } = await sdk.client.config.update({
                  config: { remote: { provider: provider.id, enableTunnel: provider.id !== "none" } } as any,
                })
                if (error) {
                  toast.show({ message: "Failed to update remote config", variant: "error" })
                  return
                }
                toast.show({ message: "Remote config updated", variant: "success" })
              },
            }
          }),
      ),
    ]

    return allOptions
  })

  return (
    <box flexDirection="column">
      <Show when={isStarting()}>
        <text fg="yellow">Starting remote session...</text>
      </Show>
      <Show when={terminalConnection()}>
        <TerminalView connection={terminalConnection()!} />
      </Show>
      <Show when={!terminalConnection() && !qrData()}>
        <DialogSelect
          ref={(r) => setRef(r as any)}
          onFilter={setQuery}
          skipFilter={true}
          title="Remote Access"
          options={options() as any}
        />
      </Show>
      <Show when={!terminalConnection() && qrData()}>
        <box border={["top", "bottom", "left", "right"]} borderColor="green" padding={1}>
          <box flexDirection="row" gap={2}>
            <box flexDirection="column" width={50}>
              <text attributes={TextAttributes.BOLD} fg="green">
                Remote Session Active
              </text>
              <scrollbox flexDirection="column" maxHeight={3} scrollbarOptions={{ visible: false }}>
                <text fg="cyan">{sessionInfo()?.url}</text>
              </scrollbox>
              <text fg="gray">Local: {sessionInfo()?.localUrl}</text>
              <box marginTop={1}>
                <text fg="gray">Devices connected: {devices().length}</text>
              </box>
              <box marginTop={1}>
                <text fg="gray">Scan QR or open URL on phone</text>
              </box>
              <box marginTop={1}>
                <text fg="gray">Press 'q' to stop</text>
              </box>
            </box>
            <QRCodeDisplay qrText={qrData()} />
          </box>
        </box>
      </Show>
    </box>
  )

  function attachRemoteListeners() {
    cleanupListeners?.()

    const onConnected = (session: RemoteSession, device: any) => {
      setDevices((prev) => [
        ...prev,
        { id: device.id, name: device.name || device.userAgent || "Unknown", connectedAt: new Date() },
      ])
      if (session) {
        syncSessionInfo(session)
      }
      toast.show({ message: `Device connected: ${device.name || device.id}`, variant: "success" })
    }

    const onDisconnected = (session: RemoteSession, device: any) => {
      setDevices((prev) => prev.filter((d) => d.id !== device.id))
      if (session) {
        syncSessionInfo(session)
      }
      toast.show({ message: "Device disconnected", variant: "info" })
    }

    const onStopped = () => {
      stopRemoteSession({ silent: true })
    }

    remoteService.on("device:connected", onConnected)
    remoteService.on("device:disconnected", onDisconnected)
    remoteService.on("session:stopped", onStopped)

    cleanupListeners = () => {
      remoteService.off("device:connected", onConnected)
      remoteService.off("device:disconnected", onDisconnected)
      remoteService.off("session:stopped", onStopped)
    }
  }

  function attachRendererBridge() {
    if (detachRendererBridge || !renderer) return
    const target = renderer as unknown as {
      realStdoutWrite?: typeof process.stdout.write
      stdout?: NodeJS.WriteStream
    }
    const stdout = target.stdout ?? process.stdout
    const forward = (data: string | Uint8Array) => {
      const text = typeof data === "string" ? data : Buffer.from(data).toString()
      remoteService.writeToTerminal(text)
    }
    const original = target.realStdoutWrite?.bind(stdout)
    if (original) {
      const bridge = ((
        data: string | Uint8Array,
        encoding?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void,
      ) => {
        const result =
          typeof encoding === "function"
            ? original(data, encoding)
            : original(data, encoding as BufferEncoding | undefined, cb)
        forward(data)
        return result
      }) as typeof stdout.write
      target.realStdoutWrite = bridge

      detachRendererBridge = () => {
        target.realStdoutWrite = original
        detachRendererBridge = null
      }
      return
    }

    const base = stdout.write.bind(stdout)
    const bridge = ((
      data: string | Uint8Array,
      encoding?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ) => {
      const result =
        typeof encoding === "function" ? base(data, encoding) : base(data, encoding as BufferEncoding | undefined, cb)
      forward(data)
      return result
    }) as typeof stdout.write
    stdout.write = bridge

    detachRendererBridge = () => {
      stdout.write = base
      detachRendererBridge = null
    }
  }

  function syncSessionInfo(session: RemoteSession) {
    const url = session.tunnelUrl || session.qrUrl
    generateQR(url)
      .then((qrAscii) => {
        setQrData(qrAscii)
      })
      .catch(() => {
        setQrData("")
      })
    setSessionInfo({
      url,
      localUrl: session.localUrl || session.qrUrl,
      port: session.port ?? remoteService.getServerPort(),
    })
    setDevices(
      (session.connectedDevices || []).map((device) => ({
        id: device.id,
        name: device.userAgent || "Unknown",
        connectedAt: new Date(device.connectedAt),
      })),
    )
  }

  function buildSessionUrl(session: RemoteSession, baseUrl: string) {
    const url = new URL(baseUrl)
    url.searchParams.set("s", session.id)
    const secret = remoteService.getSessionSecret()
    if (secret) {
      url.searchParams.set("t", secret)
    }
    return url.toString()
  }

  function buildWsUrl(info: { localUrl: string; port: number }) {
    if (info.port) {
      return `ws://localhost:${info.port}`
    }
    if (info.localUrl.startsWith("https://")) {
      return info.localUrl.replace(/^https:\/\//, "wss://")
    }
    if (info.localUrl.startsWith("http://")) {
      return info.localUrl.replace(/^http:\/\//, "ws://")
    }
    return info.localUrl
  }
}
