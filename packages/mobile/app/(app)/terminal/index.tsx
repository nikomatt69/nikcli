import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { WebView, type WebViewMessageEvent } from "react-native-webview"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TerminalSquare, Plus, Trash2 } from "lucide-react-native"
import { Copy, ClipboardPaste } from "lucide-react-native"
import { Asset } from "expo-asset"
import { File } from "expo-file-system"
import * as Clipboard from "expo-clipboard"
import { useServer } from "@/lib/server-context"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { SettingsHeaderButton } from "@/components/layout/AppHeader"
import type { PtyInfo } from "@/lib/types"

// require() returns a number (resource ID) in Metro — we load the content async
const TERMINAL_HTML_MODULE = require("../../../assets/terminal.html") as number
let terminalHtmlPromise: Promise<string> | null = null

async function loadTerminalHtml(): Promise<string> {
  if (terminalHtmlPromise) return terminalHtmlPromise
  terminalHtmlPromise = (async () => {
    const [asset] = await Asset.loadAsync(TERMINAL_HTML_MODULE)
    const uri = asset.localUri ?? asset.uri
    if (!uri) throw new Error("Terminal asset URI is unavailable")
    return new File(uri).text()
  })()
  return terminalHtmlPromise
}

// ── Types ─────────────────────────────────────────────────────────────────────

type WVMessage =
  | {
      type: "status"
      status: "connected" | "disconnected" | "error" | "no_url"
    }
  | { type: "title"; title: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "copy"; text: string }

type TerminalCommand = { id: number; type: "copy" } | { id: number; type: "paste"; text: string }
type TerminalCommandInput = { type: "copy" } | { type: "paste"; text: string }

// ── PtyTab ────────────────────────────────────────────────────────────────────

type PtyTab = {
  pty: PtyInfo
  title: string
}

// ── TerminalWebView ───────────────────────────────────────────────────────────

function TerminalWebView({
  ptyId,
  wsUrl,
  theme,
  visible,
  onTitle,
  onResize,
  command,
  onCopyText,
}: {
  ptyId: string
  wsUrl: string
  theme: "dark" | "light"
  visible: boolean
  onTitle: (t: string) => void
  onResize: (ptyId: string, cols: number, rows: number) => void
  command?: TerminalCommand
  onCopyText: (text: string) => void
}) {
  const webviewRef = useRef<WebView>(null)
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "error">("connecting")
  const [htmlContent, setHtmlContent] = useState<string | null>(null)

  useEffect(() => {
    loadTerminalHtml()
      .then(setHtmlContent)
      .catch(() => setWsStatus("error"))
  }, [])

  // Inject config before the page JS runs
  const injectedJS = `
    window.__NIKCLI_PTY_CONFIG = ${JSON.stringify({ wsUrl, theme })};
    true;
  `

  useEffect(() => {
    if (!command || !htmlContent) return
    const payload = command.type === "paste" ? { type: "paste", data: command.text } : { type: "copy" }
    webviewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify(payload))} })); true;`,
    )
  }, [command, htmlContent])

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data) as WVMessage
        if (msg.type === "status") {
          if (msg.status === "connected") setWsStatus("connected")
          else if (msg.status === "error" || msg.status === "no_url") setWsStatus("error")
          else setWsStatus("connecting")
        } else if (msg.type === "title") {
          onTitle(msg.title)
        } else if (msg.type === "resize") {
          onResize(ptyId, msg.cols, msg.rows)
        } else if (msg.type === "copy") {
          onCopyText(msg.text)
        }
      } catch {}
    },
    [onCopyText, onResize, onTitle, ptyId],
  )

  return (
    <View style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0 }]} pointerEvents={visible ? "auto" : "none"}>
      {htmlContent ? (
        <WebView
          ref={webviewRef}
          source={{ html: htmlContent }}
          injectedJavaScriptBeforeContentLoaded={injectedJS}
          onMessage={handleMessage}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          scalesPageToFit={false}
          scrollEnabled={false}
          keyboardDisplayRequiresUserAction={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          style={{ flex: 1, backgroundColor: "transparent" }}
        />
      ) : null}
      {/* Connecting/loading overlay */}
      {(wsStatus === "connecting" || !htmlContent) && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(13,17,23,0.72)",
            },
          ]}
          pointerEvents="none"
        >
          <ActivityIndicator color="#58a6ff" />
          <Text
            style={{
              color: "#58a6ff",
              fontSize: 12,
              marginTop: 8,
              fontWeight: "600",
            }}
          >
            Connecting to terminal…
          </Text>
          <Text
            style={{
              color: "rgba(88,166,255,0.5)",
              fontSize: 10,
              marginTop: 4,
            }}
          >
            This may take a moment
          </Text>
        </View>
      )}
      {/* Error state */}
      {wsStatus === "error" && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(13,17,23,0.85)",
            },
          ]}
          pointerEvents="none"
        >
          <Text
            style={{
              color: "#ff7b72",
              fontSize: 14,
              fontWeight: "600",
              marginBottom: 8,
            }}
          >
            Connection Failed
          </Text>
          <Text
            style={{
              color: "rgba(230,237,243,0.6)",
              fontSize: 12,
              textAlign: "center",
              paddingHorizontal: 32,
            }}
          >
            Unable to connect to the terminal server. Check that nikcli server is running.
          </Text>
        </View>
      )}
    </View>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TAB_BAR_CLOSE_BUTTON_STYLE = { marginLeft: 2 }
const TAB_BAR_ITEM_BASE = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 6,
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 8,
  borderWidth: 1,
}

function TabBarItem({
  title,
  active,
  isDark,
  palette,
  onSelect,
  onClose,
}: {
  title: string
  active: boolean
  isDark: boolean
  palette: ReturnType<typeof useAppTheme>["palette"]
  onSelect: () => void
  onClose: () => void
}) {
  const activeAccent = isDark ? "#58a6ff" : "#0369a1"
  const activeBackground = isDark ? "rgba(88,166,255,0.15)" : "rgba(14,165,233,0.12)"
  const activeBorder = isDark ? "rgba(88,166,255,0.3)" : "rgba(14,165,233,0.2)"
  const containerStyle = useMemo(
    () => ({
      ...TAB_BAR_ITEM_BASE,
      backgroundColor: active ? activeBackground : "transparent",
      borderColor: active ? activeBorder : "transparent",
    }),
    [active, activeBackground, activeBorder],
  )
  const titleStyle = useMemo(
    () => ({
      fontSize: 12,
      fontWeight: active ? ("600" as const) : ("400" as const),
      color: active ? activeAccent : palette.soft,
      maxWidth: 100,
    }),
    [active, activeAccent, palette.soft],
  )
  const closeLabelStyle = useMemo(() => ({ fontSize: 13, color: palette.muted, lineHeight: 16 }), [palette.muted])
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="tab"
      accessibilityState={active ? { selected: true } : {}}
      accessibilityLabel={`Terminal tab ${title}`}
      style={containerStyle}
    >
      <TerminalSquare size={13} color={active ? activeAccent : palette.muted} strokeWidth={2} />
      <Text numberOfLines={1} style={titleStyle}>
        {title}
      </Text>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Close terminal tab ${title}`}
        style={TAB_BAR_CLOSE_BUTTON_STYLE}
      >
        <Text style={closeLabelStyle}>✕</Text>
      </Pressable>
    </Pressable>
  )
}

function TabBar({
  tabs,
  activeIndex,
  onSelect,
  onClose,
  palette,
  isDark,
}: {
  tabs: PtyTab[]
  activeIndex: number
  onSelect: (i: number) => void
  onClose: (i: number) => void
  palette: ReturnType<typeof useAppTheme>["palette"]
  isDark: boolean
}) {
  return (
    <FlatList
      horizontal
      data={tabs}
      keyExtractor={(_, i) => String(i)}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
      style={{
        flexShrink: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(193,208,223,0.7)",
        backgroundColor: isDark ? "#0d1117" : "#f6f9fc",
        paddingVertical: 6,
      }}
      renderItem={({ item, index }) => (
        <TabBarItem
          title={item.title}
          active={index === activeIndex}
          isDark={isDark}
          palette={palette}
          onSelect={() => onSelect(index)}
          onClose={() => onClose(index)}
        />
      )}
    />
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TerminalScreen() {
  const { client } = useServer()
  const { palette, isDark, colorScheme } = useAppTheme()
  const insets = useSafeAreaInsets()

  const [tabs, setTabs] = useState<PtyTab[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terminalCommands, setTerminalCommands] = useState<Record<string, TerminalCommand>>({})
  const commandIdRef = useRef(0)

  // ── Load existing PTY sessions on mount ───────────────────────────────────

  useEffect(() => {
    if (!client) return
    let cancelled = false
    client
      .listPty()
      .then((list) => {
        if (cancelled) return
        const existing = list.filter((p) => p.status === "running")
        if (existing.length === 0) return
        setTabs(existing.map((pty) => ({ pty, title: pty.title })))
        setActiveIndex(existing.length - 1)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Failed to load terminals")
      })
    return () => {
      cancelled = true
    }
  }, [client])

  // ── Create a new PTY ──────────────────────────────────────────────────────

  const createTerminal = useCallback(async () => {
    if (!client) return
    setCreating(true)
    setError(null)
    try {
      const pty = await client.createPty({})
      const newTab: PtyTab = { pty, title: pty.title }
      setTabs((prev) => {
        const next = [...prev, newTab]
        setActiveIndex(next.length - 1)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create terminal")
    } finally {
      setCreating(false)
    }
  }, [client])

  // ── Close a tab ───────────────────────────────────────────────────────────

  const closeTab = useCallback(
    (index: number) => {
      const tab = tabs[index]
      if (!tab) return
      // Fire-and-forget removal on backend
      client?.removePty(tab.pty.id).catch(() => {})
      setTabs((prev) => {
        const next = prev.filter((_, i) => i !== index)
        setActiveIndex((cur) => {
          if (cur >= next.length) return Math.max(0, next.length - 1)
          if (cur > index) return cur - 1
          return cur
        })
        return next
      })
    },
    [client, tabs],
  )

  // ── Confirm close all ─────────────────────────────────────────────────────

  const closeAll = useCallback(() => {
    if (tabs.length === 0) return
    Alert.alert("Close all terminals?", "All running sessions will be terminated.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Close all",
        style: "destructive",
        onPress: () => {
          tabs.forEach((t) => client?.removePty(t.pty.id).catch(() => {}))
          setTabs([])
          setActiveIndex(0)
        },
      },
    ])
  }, [client, tabs])

  // ── Update tab title from wterm title escape ──────────────────────────────

  const handleTitle = useCallback((index: number, title: string) => {
    setTabs((prev) => prev.map((t, i) => (i === index ? { ...t, title: title || t.pty.title } : t)))
  }, [])

  const resizeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const handleResize = useCallback(
    (ptyId: string, cols: number, rows: number) => {
      if (!client || !Number.isFinite(cols) || !Number.isFinite(rows)) return
      if (resizeTimersRef.current[ptyId]) clearTimeout(resizeTimersRef.current[ptyId])
      resizeTimersRef.current[ptyId] = setTimeout(() => {
        client.updatePty(ptyId, { size: { cols, rows } }).catch(() => {})
      }, 80)
    },
    [client],
  )

  const activeTab = tabs[activeIndex] ?? null

  const sendTerminalCommand = useCallback((ptyId: string, command: TerminalCommandInput) => {
    commandIdRef.current += 1
    setTerminalCommands((prev) => ({
      ...prev,
      [ptyId]: { ...command, id: commandIdRef.current } as TerminalCommand,
    }))
  }, [])

  const copyTerminal = useCallback(() => {
    if (!activeTab) return
    void triggerHaptic("selection")
    sendTerminalCommand(activeTab.pty.id, { type: "copy" })
  }, [activeTab, sendTerminalCommand])

  const pasteTerminal = useCallback(async () => {
    if (!activeTab) return
    const text = await Clipboard.getStringAsync().catch(() => "")
    if (!text) {
      Alert.alert("Clipboard empty", "Copy some text first, then paste it into the terminal.")
      return
    }
    void triggerHaptic("selection")
    sendTerminalCommand(activeTab.pty.id, { type: "paste", text })
  }, [activeTab, sendTerminalCommand])

  const handleCopyText = useCallback(async (text: string) => {
    const value = text.trimEnd()
    if (!value) {
      Alert.alert("Nothing to copy", "The terminal has no visible text yet.")
      return
    }
    await Clipboard.setStringAsync(value)
    void triggerHaptic("success")
  }, [])

  // ── Empty state ───────────────────────────────────────────────────────────

  if (tabs.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: isDark ? "#0d0d0d" : "#f6f9fc" }}>
        <View
          style={{
            position: "absolute",
            top: insets.top + 8,
            right: 16,
            zIndex: 1,
          }}
        >
          <SettingsHeaderButton />
        </View>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            gap: 12,
          }}
        >
          {error && (
            <Pressable onPress={() => setError(null)}>
              <ErrorBanner message={error} />
            </Pressable>
          )}
          <EmptyState
            title="No terminals"
            description="Open a shell session directly on your nikcli server."
            action={
              <ActionButton
                label={creating ? "Opening…" : "New terminal"}
                loading={creating}
                disabled={!client || creating}
                onPress={createTerminal}
              />
            }
          />
        </View>
      </View>
    )
  }

  // ── Terminal view ─────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: "#0d0d0d" }}>
      {/* Tab bar */}
      <View style={{}}>
        <TabBar
          tabs={tabs}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          onClose={closeTab}
          palette={palette}
          isDark={isDark}
        />
      </View>

      {/* Toolbar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: isDark ? "#0d0d0d" : "#f6f9fc",
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.6)",
        }}
      >
        {/* Current session title */}
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: "500",
            color: isDark ? "rgba(230,237,243,0.6)" : palette.muted,
            marginRight: 8,
          }}
        >
          {activeTab?.pty.cwd ?? ""}
        </Text>

        {/* Toolbar actions */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {/* Copy visible terminal */}
          <Pressable
            onPress={copyTerminal}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Copy terminal content"
          >
            <Copy size={16} color={isDark ? "rgba(230,237,243,0.75)" : palette.soft} strokeWidth={2} />
          </Pressable>

          {/* Paste clipboard */}
          <Pressable
            onPress={() => void pasteTerminal()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Paste clipboard into terminal"
          >
            <ClipboardPaste size={16} color={isDark ? "rgba(230,237,243,0.75)" : palette.soft} strokeWidth={2} />
          </Pressable>

          {/* New tab */}
          <Pressable
            onPress={createTerminal}
            disabled={creating || !client}
            accessibilityRole="button"
            accessibilityLabel="Open new terminal tab"
            accessibilityState={{ disabled: creating || !client }}
            style={{ opacity: creating || !client ? 0.4 : 1 }}
            hitSlop={8}
          >
            {creating ? (
              <ActivityIndicator size="small" color={isDark ? "#58a6ff" : "#0369a1"} />
            ) : (
              <Plus size={18} color={isDark ? "#58a6ff" : "#0369a1"} strokeWidth={2} />
            )}
          </Pressable>

          {/* Close all */}
          <Pressable
            onPress={closeAll}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close all terminal tabs"
            accessibilityHint="Terminates every open shell session"
            style={{ opacity: tabs.length === 0 ? 0.4 : 1 }}
          >
            <Trash2 size={16} color={isDark ? "rgba(255,123,114,0.85)" : palette.danger} strokeWidth={2} />
          </Pressable>

          {/* Settings */}
          <SettingsHeaderButton />
        </View>
      </View>

      {/* Terminal WebViews — render all, show only active */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {client
          ? tabs.map((tab, index) => (
              <TerminalWebView
                key={tab.pty.id}
                ptyId={tab.pty.id}
                wsUrl={client.ptyConnectUrl(tab.pty.id)}
                theme={colorScheme as "dark" | "light"}
                visible={index === activeIndex}
                onTitle={(t) => handleTitle(index, t)}
                onResize={handleResize}
                command={terminalCommands[tab.pty.id]}
                onCopyText={handleCopyText}
              />
            ))
          : null}
      </KeyboardAvoidingView>

      {/* Bottom safe area (only in empty-tab state; here filled by terminal) */}
      {Platform.OS === "ios" && <View style={{ height: insets.bottom, backgroundColor: "#0d0d0d" }} />}
    </View>
  )
}
