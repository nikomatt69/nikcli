import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { WebView, type WebViewMessageEvent } from "react-native-webview"
import { useFocusEffect } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TerminalSquare, Plus, Trash2, RefreshCw } from "lucide-react-native"
import { Copy, ClipboardPaste } from "lucide-react-native"
import { Asset } from "expo-asset"
import { File } from "expo-file-system"
import * as Clipboard from "expo-clipboard"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"
import { triggerHaptic } from "@/lib/haptics"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { ScreenBrandHeader, SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { BrandMark } from "@/components/layout/BrandMark"
import { TerminalKeyBar } from "@/components/terminal/TerminalKeyBar"
import { consumeTerminalLaunchIntent } from "@/lib/terminal-launch"
import { ptyStatusLabel, type PtyConnectionStatus } from "@/lib/terminal-keys"
import type { PtyCreateInput, PtyInfo } from "@/lib/types"

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

type TerminalCommand =
  | { id: number; type: "copy" }
  | { id: number; type: "paste"; text: string }
  | { id: number; type: "focus" }
  | { id: number; type: "blur" }
  | { id: number; type: "input"; data: string }
  | { id: number; type: "reconnect" }
type TerminalCommandInput =
  | { type: "copy" }
  | { type: "paste"; text: string }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "input"; data: string }
  | { type: "reconnect" }

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
  onStatusChange,
  command,
  onCopyText,
}: {
  ptyId: string
  wsUrl: string
  theme: "dark" | "light"
  visible: boolean
  onTitle: (t: string) => void
  onResize: (ptyId: string, cols: number, rows: number) => void
  onStatusChange: (ptyId: string, status: PtyConnectionStatus) => void
  command?: TerminalCommand
  onCopyText: (text: string) => void
}) {
  const { palette } = useAppTheme()
  const webviewRef = useRef<WebView>(null)
  const [wsStatus, setWsStatus] = useState<PtyConnectionStatus>("connecting")
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
    const payload =
      command.type === "paste"
        ? { type: "paste", data: command.text }
        : command.type === "input"
          ? { type: "input", data: command.data }
          : command.type === "focus"
            ? { type: "focus" }
            : command.type === "blur"
              ? { type: "blur" }
              : command.type === "reconnect"
                ? { type: "reconnect" }
                : { type: "copy" }
    webviewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify(payload))} })); true;`,
    )
  }, [command, htmlContent])

  useEffect(() => {
    if (!visible || !htmlContent) return
    webviewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify({ type: "focus" }))} })); true;`,
    )
  }, [htmlContent, visible])

  useEffect(() => {
    if (visible || !htmlContent) return
    webviewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify({ type: "blur" }))} })); true;`,
    )
  }, [htmlContent, visible])

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data) as WVMessage
        if (msg.type === "status") {
          const next: PtyConnectionStatus =
            msg.status === "connected"
              ? "connected"
              : msg.status === "error" || msg.status === "no_url"
                ? "error"
                : msg.status === "disconnected"
                  ? "disconnected"
                  : "connecting"
          setWsStatus(next)
          onStatusChange(ptyId, next)
        } else if (msg.type === "title") {
          onTitle(msg.title)
        } else if (msg.type === "resize") {
          onResize(ptyId, msg.cols, msg.rows)
        } else if (msg.type === "copy") {
          onCopyText(msg.text)
        }
      } catch {}
    },
    [onCopyText, onResize, onStatusChange, onTitle, ptyId],
  )

  const showBlockingOverlay = wsStatus !== "connected" || !htmlContent
  return (
    <View
      style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0 }]}
      pointerEvents={visible ? "auto" : "none"}
      collapsable={false}
    >
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
          bounces={false}
          overScrollMode="never"
          keyboardDisplayRequiresUserAction={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {showBlockingOverlay && wsStatus === "connecting" && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hexToRgba(palette.background, 0.88),
            },
          ]}
          pointerEvents="none"
        >
          <ActivityIndicator color={palette.accent} />
          <Text style={{ color: palette.accent, marginTop: 8, ...typeStyle(13, { weight: "600" }) }}>
            Connecting to terminal…
          </Text>
          <Text style={{ color: hexToRgba(palette.accent, 0.55), marginTop: 4, ...typeStyle(12) }}>
            This may take a moment
          </Text>
        </View>
      )}
      {showBlockingOverlay && wsStatus === "error" && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hexToRgba(palette.background, 0.92),
            },
          ]}
          pointerEvents="none"
        >
          <Text
            style={{
              color: palette.danger,
              fontSize: 14,
              fontWeight: "600",
              marginBottom: 8,
            }}
          >
            Connection Failed
          </Text>
          <Text
            style={{
              color: palette.muted,
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
  minHeight: 44,
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 8,
  borderCurve: "continuous" as const,
  borderWidth: 1,
}

function TabBarItem({
  title,
  active,
  palette,
  onSelect,
  onClose,
}: {
  title: string
  active: boolean
  palette: ReturnType<typeof useAppTheme>["palette"]
  onSelect: () => void
  onClose: () => void
}) {
  const activeAccent = palette.accent
  const activeBackground = hexToRgba(palette.accent, 0.16)
  const activeBorder = hexToRgba(palette.accent, 0.32)
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
      color: active ? activeAccent : palette.soft,
      maxWidth: 100,
      ...typeStyle(13, { weight: active ? "600" : "400" }),
    }),
    [active, activeAccent, palette.soft],
  )
  const closeLabelStyle = useMemo(
    () => ({ color: palette.muted, ...typeStyle(13, { weight: "600" }) }),
    [palette.muted],
  )
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
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Close terminal tab ${title}`}
        style={[TAB_BAR_CLOSE_BUTTON_STYLE, { minWidth: 28, minHeight: 44, alignItems: "center", justifyContent: "center" }]}
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
}: {
  tabs: PtyTab[]
  activeIndex: number
  onSelect: (i: number) => void
  onClose: (i: number) => void
  palette: ReturnType<typeof useAppTheme>["palette"]
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
        borderBottomColor: hexToRgba(palette.ink, 0.1),
        backgroundColor: palette.background,
        paddingVertical: 6,
      }}
      renderItem={({ item, index }) => (
        <TabBarItem
          title={item.title}
          active={index === activeIndex}
          palette={palette}
          onSelect={() => onSelect(index)}
          onClose={() => onClose(index)}
        />
      )}
    />
  )
}

function TerminalScreenHeader() {
  const { palette } = useAppTheme()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={{
        paddingTop: insets.top,
        paddingHorizontal: 16,
        paddingBottom: 6,
        backgroundColor: palette.background,
      }}
    >
      <CenteredScreenHeader title="Terminal" right={<SettingsCircleButton />} />
    </View>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TerminalScreen() {
  const { client } = useServer()
  const { palette, colorScheme } = useAppTheme()
  const insets = useSafeAreaInsets()

  const [tabs, setTabs] = useState<PtyTab[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terminalCommands, setTerminalCommands] = useState<Record<string, TerminalCommand>>({})
  const [ptyStatuses, setPtyStatuses] = useState<Record<string, PtyConnectionStatus>>({})
  const [keyModifiers, setKeyModifiers] = useState({ ctrl: false, shift: false })
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const commandIdRef = useRef(0)
  const creatingRef = useRef(false)
  const activeTabRef = useRef<PtyTab | null>(null)

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

  const createTerminal = useCallback(
    async (input: PtyCreateInput = {}) => {
      if (!client || creatingRef.current) return
      creatingRef.current = true
      setCreating(true)
      setError(null)
      try {
        const pty = await client.createPty(input)
        const newTab: PtyTab = { pty, title: input.title?.trim() || pty.title }
        setTabs((prev) => {
          const next = [...prev, newTab]
          setActiveIndex(next.length - 1)
          return next
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create terminal")
      } finally {
        creatingRef.current = false
        setCreating(false)
      }
    },
    [client],
  )

  useFocusEffect(
    useCallback(() => {
      const intent = consumeTerminalLaunchIntent()
      if (!intent || !client) return
      void createTerminal({
        cwd: intent.cwd,
        title: intent.title ?? "Session shell",
      })
    }, [client, createTerminal]),
  )

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true)
      setKeyboardInset(event.endCoordinates.height)
    })
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false)
      setKeyboardInset(0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

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

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  const sendTerminalCommand = useCallback((ptyId: string, command: TerminalCommandInput) => {
    commandIdRef.current += 1
    setTerminalCommands((prev) => ({
      ...prev,
      [ptyId]: { ...command, id: commandIdRef.current } as TerminalCommand,
    }))
  }, [])

  useFocusEffect(
    useCallback(() => {
      const tab = activeTabRef.current
      if (tab) sendTerminalCommand(tab.pty.id, { type: "focus" })
      return () => {
        const current = activeTabRef.current
        if (current) sendTerminalCommand(current.pty.id, { type: "blur" })
      }
    }, [sendTerminalCommand]),
  )

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

  const focusTerminal = useCallback(() => {
    if (!activeTab) return
    sendTerminalCommand(activeTab.pty.id, { type: "focus" })
  }, [activeTab, sendTerminalCommand])

  const sendTerminalInput = useCallback(
    (data: string) => {
      if (!activeTab || !data) return
      sendTerminalCommand(activeTab.pty.id, { type: "input", data })
    },
    [activeTab, sendTerminalCommand],
  )

  const reconnectTerminal = useCallback(() => {
    if (!activeTab) return
    void triggerHaptic("selection")
    sendTerminalCommand(activeTab.pty.id, { type: "reconnect" })
  }, [activeTab, sendTerminalCommand])

  const handlePtyStatusChange = useCallback((ptyId: string, status: PtyConnectionStatus) => {
    setPtyStatuses((prev) => ({ ...prev, [ptyId]: status }))
  }, [])

  const activeConnectionStatus = activeTab ? (ptyStatuses[activeTab.pty.id] ?? "connecting") : "connecting"
  const canReconnect = activeConnectionStatus === "error" || activeConnectionStatus === "disconnected"

  const keyBarProps = {
    disabled: !activeTab,
    ctrlActive: keyModifiers.ctrl,
    shiftActive: keyModifiers.shift,
    onToggleModifiers: setKeyModifiers,
    onFocusTerminal: focusTerminal,
    onSendInput: sendTerminalInput,
  }

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
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16 }}>
          <ScreenBrandHeader title="Terminal" right={<SettingsCircleButton />} />
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
                onPress={() => void createTerminal()}
              />
            }
          />
        </View>
      </View>
    )
  }

  // ── Terminal view ─────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {/* Top chrome — fixed height, never scrolls or shifts */}
      <View style={[styles.chrome, { backgroundColor: palette.background }]}>
        <TerminalScreenHeader />
        <TabBar
          tabs={tabs}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          onClose={closeTab}
          palette={palette}
        />
        <View
          style={[
            styles.toolbar,
            {
              backgroundColor: palette.background,
              borderBottomColor: hexToRgba(palette.ink, 0.08),
            },
          ]}
        >
          {/* Connection + cwd */}
          <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor:
                    activeConnectionStatus === "connected"
                      ? palette.success
                      : activeConnectionStatus === "connecting"
                        ? palette.warn
                        : activeConnectionStatus === "disconnected"
                          ? palette.accent
                          : palette.danger,
                }}
              />
              <Text style={{ color: palette.soft, ...typeStyle(12, { weight: "600" }) }}>
                {ptyStatusLabel(activeConnectionStatus)}
              </Text>
              {canReconnect ? (
                <Pressable
                  onPress={reconnectTerminal}
                  accessibilityRole="button"
                  accessibilityLabel="Reconnect terminal"
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <RefreshCw size={14} color={palette.accent} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </View>
            <Text
              selectable
              numberOfLines={1}
              style={{
                color: palette.muted,
                ...typeStyle(12, { weight: "500" }),
              }}
            >
              {activeTab?.pty.cwd ?? ""}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
              onPress={copyTerminal}
              accessibilityRole="button"
              accessibilityLabel="Copy terminal content"
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Copy size={16} color={palette.soft} strokeWidth={2} />
            </Pressable>
            <Pressable
              onPress={() => void pasteTerminal()}
              accessibilityRole="button"
              accessibilityLabel="Paste clipboard into terminal"
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <ClipboardPaste size={16} color={palette.soft} strokeWidth={2} />
            </Pressable>
            <Pressable
              onPress={() => void createTerminal()}
              disabled={creating || !client}
              accessibilityRole="button"
              accessibilityLabel="Open new terminal tab"
              accessibilityState={{ disabled: creating || !client }}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: creating || !client ? 0.4 : pressed ? 0.65 : 1,
              })}
            >
              {creating ? (
                <ActivityIndicator size="small" color={palette.accent} />
              ) : (
                <Plus size={18} color={palette.accent} strokeWidth={2} />
              )}
            </Pressable>
            <Pressable
              onPress={closeAll}
              accessibilityRole="button"
              accessibilityLabel="Close all terminal tabs"
              accessibilityHint="Terminates every open shell session"
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: tabs.length === 0 ? 0.4 : pressed ? 0.65 : 1,
              })}
            >
              <Trash2 size={16} color={palette.danger} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* Terminal dock — fills remaining space, anchored to bottom; shrinks upward when keyboard opens */}
      <View style={[styles.terminalDock, { backgroundColor: palette.codeBlockBackground }, keyboardInset > 0 ? { paddingBottom: keyboardInset } : null]}>
        <View style={[styles.terminalViewport, { backgroundColor: palette.codeBlockBackground }]} collapsable={false}>
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
                  onStatusChange={handlePtyStatusChange}
                  command={terminalCommands[tab.pty.id]}
                  onCopyText={handleCopyText}
                />
              ))
            : null}
        </View>
        {!keyboardVisible ? <TerminalKeyBar {...keyBarProps} /> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  chrome: {
    flexShrink: 0,
    zIndex: 2,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  terminalDock: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  terminalViewport: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
  },
})
