import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { WebView, type WebViewMessageEvent } from "react-native-webview"
import { useFocusEffect } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TerminalSquare, Plus, Trash2, RefreshCw, ALargeSmall } from "lucide-react-native"
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
import { SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { BrandMark } from "@/components/layout/BrandMark"
import { TerminalKeyBar } from "@/components/terminal/TerminalKeyBar"
import { consumeTerminalLaunchIntent } from "@/lib/terminal-launch"
import { ptyStatusColor, ptyStatusLabel, type PtyConnectionStatus } from "@/lib/terminal-keys"
import type { PtyCreateInput, PtyInfo } from "@/lib/types"

const TERMINAL_HTML_MODULE = require("../../../assets/terminal.html") as number
const WTERM_BUNDLE_MODULE = require("../../../assets/wterm.bundle.txt") as number

let terminalHtmlPromise: Promise<string> | null = null

async function loadAssetText(moduleId: number): Promise<string> {
  const [asset] = await Asset.loadAsync(moduleId)
  const uri = asset.localUri ?? asset.uri
  if (!uri) throw new Error("Terminal asset URI is unavailable")
  return new File(uri).text()
}

async function loadTerminalHtml(): Promise<string> {
  if (terminalHtmlPromise) return terminalHtmlPromise
  terminalHtmlPromise = (async () => {
    const [html, bundle] = await Promise.all([loadAssetText(TERMINAL_HTML_MODULE), loadAssetText(WTERM_BUNDLE_MODULE)])
    if (!html.includes("__WTERM_BUNDLE__")) {
      throw new Error("Terminal HTML is missing wterm injection marker")
    }
    return html.replace("__WTERM_BUNDLE__", bundle)
  })()
  return terminalHtmlPromise
}

type WVMessage =
  | {
      type: "status"
      status: "connected" | "disconnected" | "error" | "no_url" | "connecting"
    }
  | { type: "title"; title: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "copy"; text: string }
  | { type: "selection"; text: string }

type TerminalCommand =
  | { id: number; type: "copy" }
  | { id: number; type: "paste"; text: string }
  | { id: number; type: "focus" }
  | { id: number; type: "blur" }
  | { id: number; type: "input"; data: string }
  | { id: number; type: "reconnect"; wsUrl?: string }
  | { id: number; type: "theme"; theme: "dark" | "light" }
  | { id: number; type: "fontSize"; size: number }

type TerminalCommandInput =
  | { type: "copy" }
  | { type: "paste"; text: string }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "input"; data: string }
  | { type: "reconnect"; wsUrl?: string }
  | { type: "theme"; theme: "dark" | "light" }
  | { type: "fontSize"; size: number }

type PtyTab = {
  pty: PtyInfo
  title: string
  directory?: string
}

function commandPayload(command: TerminalCommand): Record<string, unknown> {
  if (command.type === "paste") return { type: "paste", data: command.text }
  if (command.type === "input") return { type: "input", data: command.data }
  if (command.type === "focus") return { type: "focus" }
  if (command.type === "blur") return { type: "blur" }
  if (command.type === "reconnect") {
    return command.wsUrl ? { type: "reconnect", wsUrl: command.wsUrl } : { type: "reconnect" }
  }
  if (command.type === "theme") return { type: "theme", theme: command.theme }
  if (command.type === "fontSize") return { type: "fontSize", size: command.size }
  return { type: "copy" }
}

function TerminalWebView({
  ptyId,
  wsUrl,
  theme,
  fontSize,
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
  fontSize: number
  visible: boolean
  onTitle: (t: string) => void
  onResize: (ptyId: string, cols: number, rows: number) => void
  onStatusChange: (ptyId: string, status: PtyConnectionStatus) => void
  command?: TerminalCommand
  onCopyText: (text: string) => void
}) {
  const webviewRef = useRef<WebView>(null)
  const [wsStatus, setWsStatus] = useState<PtyConnectionStatus>("connecting")
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const lastThemeRef = useRef(theme)
  const lastFontRef = useRef(fontSize)

  useEffect(() => {
    loadTerminalHtml()
      .then(setHtmlContent)
      .catch(() => setWsStatus("error"))
  }, [])

  const injectedJS = `
    window.__NIKCLI_PTY_CONFIG = ${JSON.stringify({ wsUrl, theme, fontSize })};
    true;
  `

  useEffect(() => {
    if (!command || !htmlContent) return
    const payload = commandPayload(command)
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

  useEffect(() => {
    if (!htmlContent || lastThemeRef.current === theme) return
    lastThemeRef.current = theme
    webviewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify({ type: "theme", theme }))} })); true;`,
    )
  }, [htmlContent, theme])

  useEffect(() => {
    if (!htmlContent || lastFontRef.current === fontSize) return
    lastFontRef.current = fontSize
    webviewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify({ type: "fontSize", size: fontSize }))} })); true;`,
    )
  }, [fontSize, htmlContent])

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

  const showConnecting = !htmlContent || wsStatus === "connecting"
  const showError = wsStatus === "error"
  const showDisconnected = wsStatus === "disconnected"

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
      {showConnecting && (
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
          <Text style={{ color: "#58a6ff", fontSize: 12, marginTop: 8, fontWeight: "600" }}>
            Connecting to terminal…
          </Text>
        </View>
      )}
      {showError && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(13,17,23,0.85)",
              paddingHorizontal: 32,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={{ color: "#ff7b72", fontSize: 14, fontWeight: "600", marginBottom: 8 }}>Connection Failed</Text>
          <Text style={{ color: "rgba(230,237,243,0.6)", fontSize: 12, textAlign: "center" }}>
            Unable to connect to the terminal server. Use reconnect in the toolbar.
          </Text>
        </View>
      )}
      {showDisconnected && !showConnecting && (
        <View
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: 12,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: "rgba(88,166,255,0.16)",
            borderWidth: 1,
            borderColor: "rgba(88,166,255,0.35)",
          }}
          pointerEvents="none"
        >
          <Text style={{ color: "#79c0ff", fontSize: 12, fontWeight: "600" }}>
            Disconnected — reconnecting or tap the refresh icon
          </Text>
        </View>
      )}
    </View>
  )
}

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
  const activeAccent = isDark ? "#58a6ff" : "#141413"
  const activeBackground = isDark ? "rgba(88,166,255,0.15)" : "rgba(20,20,19,0.12)"
  const activeBorder = isDark ? "rgba(88,166,255,0.3)" : "rgba(20,20,19,0.2)"
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
      keyExtractor={(tab) => tab.pty.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
      style={{
        flexShrink: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(218,216,209,0.7)",
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

const TERMINAL_BRAND_HEIGHT = 12

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
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
        <BrandMark height={TERMINAL_BRAND_HEIGHT} />
        <Text
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 17,
            fontWeight: "600",
            color: palette.ink,
          }}
        >
          Terminal
        </Text>
        <SettingsCircleButton />
      </View>
    </View>
  )
}

export default function TerminalScreen() {
  const { client } = useServer()
  const { palette, isDark, colorScheme } = useAppTheme()

  const [tabs, setTabs] = useState<PtyTab[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terminalCommands, setTerminalCommands] = useState<Record<string, TerminalCommand>>({})
  const [ptyStatuses, setPtyStatuses] = useState<Record<string, PtyConnectionStatus>>({})
  const [keyModifiers, setKeyModifiers] = useState({ ctrl: false, shift: false })
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [fontSize, setFontSize] = useState(13)
  const commandIdRef = useRef(0)
  const creatingRef = useRef(false)
  const activeTabRef = useRef<PtyTab | null>(null)
  const resizeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const syncRunningPty = useCallback(async () => {
    if (!client) return
    try {
      const list = await client.listPty()
      const running = new Map(list.filter((p) => p.status === "running").map((p) => [p.id, p]))
      setTabs((prev) => {
        if (prev.length === 0 && running.size > 0) {
          const next = [...running.values()].map((pty) => ({ pty, title: pty.title }))
          setActiveIndex(next.length - 1)
          return next
        }
        let changed = false
        const next = prev.map((tab) => {
          const live = running.get(tab.pty.id)
          if (!live) {
            changed = true
            setPtyStatuses((statuses) => ({ ...statuses, [tab.pty.id]: "exited" }))
            return { ...tab, pty: { ...tab.pty, status: "exited" as const } }
          }
          if (live.title !== tab.pty.title || live.cwd !== tab.pty.cwd) {
            changed = true
            return { ...tab, pty: live, title: tab.title || live.title }
          }
          return tab
        })
        return changed ? next : prev
      })
    } catch {
      // ignore transient list failures
    }
  }, [client])

  useEffect(() => {
    void syncRunningPty()
  }, [syncRunningPty])

  const createTerminal = useCallback(
    async (input: PtyCreateInput & { directory?: string } = {}) => {
      if (!client || creatingRef.current) return
      creatingRef.current = true
      setCreating(true)
      setError(null)
      try {
        const directory = input.directory ?? input.cwd
        const scoped = directory ? client.withDirectory(directory) : client
        const { directory: _dir, ...body } = input
        const pty = await scoped.createPty(body)
        const newTab: PtyTab = {
          pty,
          title: input.title?.trim() || pty.title,
          directory: directory ?? undefined,
        }
        setTabs((prev) => {
          const next = [...prev, newTab]
          setActiveIndex(next.length - 1)
          return next
        })
        setPtyStatuses((prev) => ({ ...prev, [pty.id]: "connecting" }))
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
      void syncRunningPty()
      const intent = consumeTerminalLaunchIntent()
      if (!intent || !client) return
      void createTerminal({
        cwd: intent.cwd,
        directory: intent.cwd,
        title: intent.title ?? (intent.command ? "nikcli" : "Session shell"),
        command: intent.command,
        args: intent.args,
      })
    }, [client, createTerminal, syncRunningPty]),
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

  const closeTab = useCallback(
    (index: number) => {
      const tab = tabs[index]
      if (!tab) return
      if (resizeTimersRef.current[tab.pty.id]) {
        clearTimeout(resizeTimersRef.current[tab.pty.id])
        delete resizeTimersRef.current[tab.pty.id]
      }
      client?.removePty(tab.pty.id).catch(() => {})
      setTerminalCommands((prev) => {
        const next = { ...prev }
        delete next[tab.pty.id]
        return next
      })
      setPtyStatuses((prev) => {
        const next = { ...prev }
        delete next[tab.pty.id]
        return next
      })
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
          setTerminalCommands({})
          setPtyStatuses({})
        },
      },
    ])
  }, [client, tabs])

  const handleTitle = useCallback((index: number, title: string) => {
    setTabs((prev) => prev.map((t, i) => (i === index ? { ...t, title: title || t.pty.title } : t)))
  }, [])

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

  const hideKeyboard = useCallback(() => {
    Keyboard.dismiss()
    // Keep OpenTUI focus reporting in-sync: blur soft keyboard but re-assert PTY focus.
    if (activeTab) {
      sendTerminalCommand(activeTab.pty.id, { type: "focus" })
    }
  }, [activeTab, sendTerminalCommand])

  const reconnectTerminal = useCallback(() => {
    if (!activeTab || !client) return
    void triggerHaptic("selection")
    const scoped = activeTab.directory ? client.withDirectory(activeTab.directory) : client
    const wsUrl = scoped.ptyConnectUrl(activeTab.pty.id)
    sendTerminalCommand(activeTab.pty.id, { type: "reconnect", wsUrl })
  }, [activeTab, client, sendTerminalCommand])

  const restartExitedTab = useCallback(async () => {
    if (!activeTab) return
    const { cwd, title } = activeTab.pty
    const directory = activeTab.directory
    closeTab(activeIndex)
    await createTerminal({
      cwd,
      directory,
      title: title || "Terminal",
    })
  }, [activeIndex, activeTab, closeTab, createTerminal])

  const cycleFontSize = useCallback(() => {
    setFontSize((prev) => {
      const next = prev >= 16 ? 11 : prev + 1
      void triggerHaptic("selection")
      return next
    })
  }, [])

  const handlePtyStatusChange = useCallback((ptyId: string, status: PtyConnectionStatus) => {
    setPtyStatuses((prev) => ({ ...prev, [ptyId]: status }))
  }, [])

  const activeConnectionStatus = activeTab
    ? activeTab.pty.status === "exited"
      ? "exited"
      : (ptyStatuses[activeTab.pty.id] ?? "connecting")
    : "connecting"
  const canReconnect =
    activeConnectionStatus === "error" ||
    activeConnectionStatus === "disconnected" ||
    activeConnectionStatus === "exited"

  const keyBarProps = {
    disabled: !activeTab,
    ctrlActive: keyModifiers.ctrl,
    shiftActive: keyModifiers.shift,
    keyboardVisible,
    onToggleModifiers: setKeyModifiers,
    onFocusTerminal: focusTerminal,
    onSendInput: sendTerminalInput,
    onHideKeyboard: hideKeyboard,
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

  const theme = (colorScheme === "light" ? "light" : "dark") as "dark" | "light"

  if (tabs.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: isDark ? "#0d0d0d" : "#f6f9fc" }}>
        <TerminalScreenHeader />
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 12 }}>
          {error && (
            <Pressable onPress={() => setError(null)}>
              <ErrorBanner message={error} />
            </Pressable>
          )}
          <EmptyState
            title="No terminals"
            description="Open a remote shell, or launch nikcli TUI in a PTY. Sessions remains the primary agent UI."
            action={
              <View style={{ gap: 10, width: "100%" }}>
                <ActionButton
                  label={creating ? "Opening…" : "New shell"}
                  loading={creating}
                  disabled={!client || creating}
                  onPress={() => void createTerminal()}
                />
                <ActionButton
                  label="Open nikcli"
                  disabled={!client || creating}
                  onPress={() =>
                    void createTerminal({
                      command: "nikcli",
                      title: "nikcli",
                    })
                  }
                />
              </View>
            }
          />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.chrome}>
        <TerminalScreenHeader />
        <TabBar
          tabs={tabs}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          onClose={closeTab}
          palette={palette}
          isDark={isDark}
        />
        <View style={[styles.toolbar, isDark ? styles.toolbarDark : styles.toolbarLight]}>
          <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: ptyStatusColor(activeConnectionStatus),
                }}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: isDark ? "rgba(230,237,243,0.72)" : palette.soft,
                }}
              >
                {ptyStatusLabel(activeConnectionStatus)}
              </Text>
              {canReconnect ? (
                <Pressable
                  onPress={() => {
                    if (activeConnectionStatus === "exited") void restartExitedTab()
                    else reconnectTerminal()
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={activeConnectionStatus === "exited" ? "Restart terminal" : "Reconnect terminal"}
                  style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                >
                  <RefreshCw size={14} color={isDark ? "#58a6ff" : palette.accentLight} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12,
                fontWeight: "500",
                color: isDark ? "rgba(230,237,243,0.6)" : palette.muted,
              }}
            >
              {activeTab?.pty.cwd ?? ""}
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Pressable
              onPress={cycleFontSize}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Font size ${fontSize}`}
            >
              <ALargeSmall size={16} color={isDark ? "rgba(230,237,243,0.75)" : palette.soft} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={copyTerminal} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy">
              <Copy size={16} color={isDark ? "rgba(230,237,243,0.75)" : palette.soft} strokeWidth={2} />
            </Pressable>
            <Pressable
              onPress={() => void pasteTerminal()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Paste"
            >
              <ClipboardPaste size={16} color={isDark ? "rgba(230,237,243,0.75)" : palette.soft} strokeWidth={2} />
            </Pressable>
            <Pressable
              onPress={() => void createTerminal()}
              disabled={creating || !client}
              accessibilityRole="button"
              accessibilityLabel="Open new terminal tab"
              style={{ opacity: creating || !client ? 0.4 : 1 }}
              hitSlop={8}
            >
              {creating ? (
                <ActivityIndicator size="small" color={isDark ? "#58a6ff" : "#141413"} />
              ) : (
                <Plus size={18} color={isDark ? "#58a6ff" : "#141413"} strokeWidth={2} />
              )}
            </Pressable>
            <Pressable
              onPress={closeAll}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close all terminal tabs"
              style={{ opacity: tabs.length === 0 ? 0.4 : 1 }}
            >
              <Trash2 size={16} color={isDark ? "rgba(255,123,114,0.85)" : palette.danger} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={[styles.terminalDock, keyboardInset > 0 ? { paddingBottom: keyboardInset } : null]}>
        <View style={styles.terminalViewport} collapsable={false}>
          {client
            ? tabs.map((tab, index) => {
                const scoped = tab.directory ? client.withDirectory(tab.directory) : client
                return (
                  <TerminalWebView
                    key={tab.pty.id}
                    ptyId={tab.pty.id}
                    wsUrl={scoped.ptyConnectUrl(tab.pty.id)}
                    theme={theme}
                    fontSize={fontSize}
                    visible={index === activeIndex}
                    onTitle={(t) => handleTitle(index, t)}
                    onResize={handleResize}
                    onStatusChange={handlePtyStatusChange}
                    command={terminalCommands[tab.pty.id]}
                    onCopyText={handleCopyText}
                  />
                )
              })
            : null}
        </View>
        <TerminalKeyBar {...keyBarProps} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0d0d0d",
  },
  chrome: {
    flexShrink: 0,
    zIndex: 2,
    backgroundColor: "#0d0d0d",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarDark: {
    backgroundColor: "#0d0d0d",
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  toolbarLight: {
    backgroundColor: "#f6f9fc",
    borderBottomColor: "rgba(218,216,209,0.6)",
  },
  terminalDock: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: "#0d0d0d",
  },
  terminalViewport: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#0d0d0d",
  },
})
