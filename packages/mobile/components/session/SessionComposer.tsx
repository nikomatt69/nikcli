import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { ArrowUp, Code2, GitBranch, Lock, MapPin, Paperclip, Plus, Square, Terminal, X } from "lucide-react-native"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ComposerToolDrawer, type ComposerTab } from "./ComposerToolDrawer"

export type SessionComposerProps = {
  mode: "plan" | "code"
  setMode(mode: "plan" | "code"): void
  input: string
  setInput(value: string): void
  slashSuggestions?: Array<{
    name: string
    description?: string
    badge?: string
  }>
  slashLoading?: boolean
  sending: boolean
  sessionBlocked: boolean
  cleaned: boolean
  onOpenCommands(): void
  onSelectSlash(name: string): void
  onSend(): void
  onAttach?(): void
  onOpenGit?(): void
  onStop?(): void
  pendingAttachments?: Array<{
    id: string
    mime?: string
    filename?: string
    base64?: string
    previewUri?: string
    sizeLabel?: string
    uri?: string
    name?: string
    type?: string
  }>
  onAddAttachment?(item: {
    id: string
    mime?: string
    filename?: string
    base64?: string
    previewUri?: string
    sizeLabel?: string
    uri?: string
    name?: string
    type?: string
  }): void
  onRemoveAttachment?(id: string): void
  modelLabel?: string
  activeMcpCount?: number
  availableModels?: Array<{ id: string; name: string; badge?: string }>
  skills?: Array<{ name: string; description?: string; category?: string }>
  tools?: Array<{ name: string; description?: string; enabled: boolean }>
  mcpServers?: Array<{ name: string; connected: boolean; enabled: boolean }>
  onModelSelect?(id: string): void
  onSkillSelect?(name: string): void
  onToolToggle?(name: string, enabled: boolean): void
  onMcpToggle?(name: string, enabled: boolean): void
  onSkillsManage?(): void
  onToolsManage?(): void
  onMcpManage?(): void
}

const CHAR_COUNT_THRESHOLD = 100
// Each segment width — pill animates between [2, SEGMENT_W + 2]
const SEGMENT_W = 68
// TextInput line metrics
const INPUT_LINE_HEIGHT = 22
const INPUT_PADDING_TOP = 14
const INPUT_PADDING_BOTTOM = 10
const INPUT_MIN_ROWS = 2
const INPUT_MAX_ROWS = 6
const INPUT_MIN_HEIGHT = INPUT_PADDING_TOP + INPUT_MIN_ROWS * INPUT_LINE_HEIGHT + INPUT_PADDING_BOTTOM // 68
const INPUT_MAX_HEIGHT = INPUT_PADDING_TOP + INPUT_MAX_ROWS * INPUT_LINE_HEIGHT + INPUT_PADDING_BOTTOM // 156

export function SessionComposer({
  mode,
  setMode,
  input,
  setInput,
  slashSuggestions = [],
  slashLoading,
  sending,
  sessionBlocked,
  cleaned,
  onOpenCommands,
  onSelectSlash,
  onSend,
  onAttach,
  onOpenGit,
  onStop,
  pendingAttachments = [],
  onRemoveAttachment,
  modelLabel,
  activeMcpCount = 0,
  availableModels = [],
  skills = [],
  tools = [],
  mcpServers = [],
  onModelSelect,
  onSkillSelect,
  onToolToggle,
  onMcpToggle,
  onSkillsManage,
  onToolsManage,
  onMcpManage,
}: SessionComposerProps) {
  const { palette, isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const inputRef = useRef<TextInput>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [activeTab, setActiveTab] = useState<ComposerTab>("tools")

  const sendBlocked = sessionBlocked || cleaned || !input.trim()
  const sendDisabled = sending || sendBlocked
  const showSlash = input.trimStart().startsWith("/")
  const hasText = input.trim().length > 0
  const charCount = input.length
  const showCharCount = charCount > CHAR_COUNT_THRESHOLD
  const showStatus = sessionBlocked || cleaned
  const hasAttachments = pendingAttachments.length > 0

  // ── Animation values ──────────────────────────────────────────────────────

  // Focus: border glow (non-native — drives borderColor interpolation)
  const focusAnim = useRef(new Animated.Value(0)).current

  // Send button: color transition (non-native)
  const sendColorAnim = useRef(new Animated.Value(hasText && !sendBlocked ? 1 : 0)).current

  // Send button: scale spring pop (native)
  const sendScaleAnim = useRef(new Animated.Value(1)).current

  // Stop button: pulsing scale (native)
  const stopPulse = useRef(new Animated.Value(1)).current

  // Mode segmented control: sliding pill (non-native for left position)
  const modeAnim = useRef(new Animated.Value(mode === "code" ? 1 : 0)).current

  // Slash panel: fade + slide (native)
  const slashAnim = useRef(new Animated.Value(0)).current

  // Status banner: slide down (native)
  const statusAnim = useRef(new Animated.Value(0)).current

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: isFocused ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
      easing: Easing.out(Easing.ease),
    }).start()
  }, [isFocused, focusAnim])

  useEffect(() => {
    const isReady = hasText && !sendBlocked
    Animated.timing(sendColorAnim, {
      toValue: isReady ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
      easing: Easing.out(Easing.ease),
    }).start()
    if (isReady) {
      Animated.spring(sendScaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 11,
        stiffness: 260,
        mass: 0.7,
      }).start()
    } else {
      Animated.spring(sendScaleAnim, {
        toValue: 0.88,
        useNativeDriver: true,
        damping: 14,
        stiffness: 200,
        mass: 0.8,
      }).start()
    }
  }, [hasText, sendBlocked, sendColorAnim, sendScaleAnim])

  useEffect(() => {
    if (!sending) {
      stopPulse.setValue(1)
      return
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(stopPulse, {
          toValue: 1.14,
          duration: 680,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(stopPulse, {
          toValue: 1,
          duration: 680,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    )
    pulse.start()
    return () => pulse.stop()
  }, [sending, stopPulse])

  useEffect(() => {
    Animated.timing(modeAnim, {
      toValue: mode === "code" ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
      easing: Easing.out(Easing.quad),
    }).start()
  }, [mode, modeAnim])

  useEffect(() => {
    Animated.spring(slashAnim, {
      toValue: showSlash ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.9,
    }).start()
  }, [showSlash, slashAnim])

  useEffect(() => {
    Animated.spring(statusAnim, {
      toValue: showStatus ? 1 : 0,
      useNativeDriver: true,
      damping: 16,
      stiffness: 200,
    }).start()
  }, [showStatus, statusAnim])

  // ── Derived animated styles ───────────────────────────────────────────────

  const borderColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.border, isDark ? "rgba(255,255,255,0.28)" : "rgba(14,165,233,0.38)"],
  })

  // Inactive → topbar glass; active → accent fill
  const sendBg = sendColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)", palette.accent],
  })

  // Pill slides from left-edge-gap (2) to second segment start (SEGMENT_W + 2)
  const segmentPillLeft = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, SEGMENT_W + 2], // [2, 70] with SEGMENT_W=68
  })

  const segmentLabelPlan = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? palette.accentLight : palette.accentLight, palette.muted],
  })

  const segmentLabelCode = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.muted, isDark ? palette.accentLight : palette.accentLight],
  })

  const slashTranslateY = slashAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] })
  const statusTranslateY = statusAnim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] })

  // ── Icon button style ─────────────────────────────────────────────────────
  const iconBtn = useMemo(
    () => ({
      borderRadius: 999,
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(193,208,223,0.78)",
      backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.82)",
    }),
    [isDark],
  )

  return (
    <View
      style={{
        backgroundColor: isDark ? palette.surface : palette.background,
        paddingBottom: Math.max(insets.bottom, 10),
      }}
    >
      {/* Top hairline separator */}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />

      {/* Status banner — glass pill, animated slide-down */}
      {showStatus && (
        <Animated.View
          style={{
            opacity: statusAnim,
            transform: [{ translateY: statusTranslateY }],
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingVertical: 9,
              paddingHorizontal: 16,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: palette.border,
              backgroundColor: cleaned
                ? isDark
                  ? "rgba(143,143,143,0.07)"
                  : "rgba(220,38,38,0.06)"
                : isDark
                  ? "rgba(183,183,183,0.07)"
                  : "rgba(217,119,6,0.07)",
            }}
          >
            {sessionBlocked ? (
              <ActivityIndicator size={10} color={palette.warn} />
            ) : (
              <Lock size={11} color={palette.danger} strokeWidth={2.2} />
            )}
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                letterSpacing: 0.2,
                color: sessionBlocked ? palette.warn : palette.danger,
              }}
            >
              {cleaned ? "Read-only worktree" : "Processing…"}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Slash autocomplete — animated fade + slide up */}
      {showSlash && (
        <Animated.View
          style={{
            opacity: slashAnim,
            transform: [{ translateY: slashTranslateY }],
          }}
        >
          {/* Glass surface matching app tab bar language */}
          <View
            style={{
              marginHorizontal: 14,
              marginBottom: 6,
              borderRadius: 18,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.78)",
              shadowColor: palette.shadow,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: isDark ? 0.2 : 0.08,
              shadowRadius: 14,
            }}
          >
            {/* Glass background */}
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(17,17,17,0.94)" : "rgba(255,255,255,0.96)" },
              ]}
              pointerEvents="none"
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(255,255,255,0.012)" : "rgba(232,240,248,0.12)" },
              ]}
              pointerEvents="none"
            />

            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: "700",
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  color: palette.muted,
                }}
              >
                {slashSuggestions.length
                  ? `${slashSuggestions.length} command${slashSuggestions.length > 1 ? "s" : ""}`
                  : "Commands"}
              </Text>
              {slashLoading && <ActivityIndicator size="small" color={palette.accent} />}
            </View>

            {slashSuggestions.length ? (
              slashSuggestions.slice(0, 5).map((item, i) => (
                <Pressable
                  key={item.name}
                  onPress={() => {
                    void triggerHaptic("selection")
                    onSelectSlash(item.name)
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    backgroundColor: pressed
                      ? isDark
                        ? "rgba(255,255,255,0.07)"
                        : "rgba(14,165,233,0.06)"
                      : "transparent",
                    borderBottomWidth: i < Math.min(slashSuggestions.length, 5) - 1 ? StyleSheet.hairlineWidth : 0,
                    borderBottomColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                  })}
                >
                  {/* Command name + description */}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        letterSpacing: -0.2,
                        color: palette.accentLight,
                      }}
                      numberOfLines={1}
                    >
                      /{item.name}
                    </Text>
                    {item.description ? (
                      <Text
                        style={{
                          color: palette.soft,
                          fontSize: 11.5,
                          marginTop: 2,
                          lineHeight: 15,
                        }}
                        numberOfLines={1}
                      >
                        {item.description}
                      </Text>
                    ) : null}
                  </View>

                  {/* Badge */}
                  {item.badge ? (
                    <View
                      style={{
                        backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.08)",
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(14,165,233,0.14)",
                        paddingHorizontal: 7,
                        paddingVertical: 3,
                        marginLeft: 10,
                        flexShrink: 0,
                      }}
                    >
                      <Text style={{ color: palette.accentLight, fontSize: 9, fontWeight: "700", letterSpacing: 0.5 }}>
                        {item.badge.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ))
            ) : !slashLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 16 }}>
                <Text style={{ color: palette.muted, fontSize: 13, fontWeight: "500" }}>No matching commands</Text>
              </View>
            ) : null}
          </View>
        </Animated.View>
      )}

      {/* Main capsule */}
      <View style={{ marginHorizontal: 14, marginTop: 10 }}>
        {/* Shadow wrapper — outside overflow:hidden so shadow renders */}
        <View
          style={{
            borderRadius: 24,
            shadowColor: palette.shadow,
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: isDark ? 0.24 : 0.1,
            shadowRadius: 20,
          }}
        >
          {/* Clip container */}
          <View style={styles.capsule}>
            {/* Glass background */}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark ? "rgba(17,17,17,0.92)" : "rgba(255,255,255,0.95)",
                },
              ]}
              pointerEvents="none"
            />
            {/* Inner tint for depth */}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark ? "rgba(255,255,255,0.015)" : "rgba(232,240,248,0.15)",
                },
              ]}
              pointerEvents="none"
            />
            {/* Animated border overlay */}
            <Animated.View
              style={[StyleSheet.absoluteFill, { borderRadius: 24, borderWidth: 1, borderColor }]}
              pointerEvents="none"
            />

            {/* TextInput */}
            <TextInput
              ref={inputRef}
              value={input}
              onChangeText={setInput}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              multiline
              editable={!cleaned}
              selectionColor={palette.accent}
              keyboardAppearance={isDark ? "dark" : "light"}
              returnKeyType="default"
              placeholder={
                cleaned ? "Worktree cleaned up" : mode === "plan" ? "What would you like to plan?" : "Reply to Nikcli…"
              }
              placeholderTextColor={palette.muted}
              style={{
                fontSize: 16,
                lineHeight: INPUT_LINE_HEIGHT,
                color: palette.ink,
                maxHeight: INPUT_MAX_HEIGHT,
                minHeight: INPUT_MIN_HEIGHT,
                paddingTop: INPUT_PADDING_TOP,
                paddingBottom: INPUT_PADDING_BOTTOM,
                paddingHorizontal: 18,
                textAlignVertical: "top",
              }}
            />

            {/* Input / toolbar separator */}
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                marginHorizontal: 16,
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.6)",
              }}
            />

            {/* Toolbar */}
            <View style={styles.toolbar}>
              {/* Left cluster - icons with spacing */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {/* Attach */}
                {onAttach ? (
                  <Pressable
                    onPress={() => {
                      void triggerHaptic("selection")
                      Keyboard.dismiss()
                      onAttach()
                    }}
                    disabled={cleaned}
                    accessibilityRole="button"
                    accessibilityLabel="Attach file"
                    accessibilityState={{ disabled: cleaned }}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      ...iconBtn,
                      padding: 8,
                      opacity: cleaned ? 0.3 : pressed ? 0.68 : 1,
                      transform: [{ scale: pressed ? 0.94 : 1 }],
                    })}
                  >
                    <Paperclip size={15} color={palette.soft} strokeWidth={2} />
                    {pendingAttachments.length > 0 ? (
                      <View
                        style={{
                          position: "absolute",
                          top: -5,
                          right: -5,
                          minWidth: 16,
                          height: 16,
                          borderRadius: 999,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: palette.accent,
                          borderWidth: 1,
                          borderColor: isDark ? palette.surface : "#fff",
                        }}
                      >
                        <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
                          {pendingAttachments.length}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                ) : null}

                {/* Commands */}
                <Pressable
                  onPress={() => {
                    void triggerHaptic("selection")
                    Keyboard.dismiss()
                    onOpenCommands()
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open command palette"
                  accessibilityHint="Shows slash commands, prompt presets, tools, skills, and snippets"
                  hitSlop={6}
                  style={({ pressed }) => ({
                    ...iconBtn,
                    padding: 8,
                    opacity: pressed ? 0.68 : 1,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  })}
                >
                  <Terminal size={15} color={palette.accentLight} strokeWidth={2} />
                </Pressable>

                {/* Git */}
                {onOpenGit ? (
                  <Pressable
                    onPress={() => {
                      void triggerHaptic("selection")
                      Keyboard.dismiss()
                      onOpenGit()
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Open Git panel"
                    accessibilityHint="Shows Git changes, commits, and review"
                    hitSlop={6}
                    style={({ pressed }) => ({
                      ...iconBtn,
                      padding: 8,
                      opacity: pressed ? 0.68 : 1,
                      transform: [{ scale: pressed ? 0.94 : 1 }],
                    })}
                  >
                    <GitBranch size={15} color={palette.accentLight} strokeWidth={2} />
                  </Pressable>
                ) : null}

                {/* Plus - opens tools drawer */}
                <Pressable
                  onPress={() => {
                    void triggerHaptic("selection")
                    Keyboard.dismiss()
                    setDrawerVisible(true)
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open tools"
                  accessibilityHint="Shows tools, skills, models, and MCP controls"
                  hitSlop={6}
                  style={({ pressed }) => ({
                    ...iconBtn,
                    padding: 8,
                    opacity: pressed ? 0.68 : 1,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  })}
                >
                  <Plus size={15} color={palette.soft} strokeWidth={2} />
                </Pressable>

                {/* Mode segmented control */}
                <Pressable
                  onPress={() => {
                    void triggerHaptic("selection")
                    setMode(mode === "plan" ? "code" : "plan")
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch composer mode. Current mode is ${mode}`}
                  accessibilityHint="Toggles between planning mode and code execution mode"
                  hitSlop={4}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.78 : 1,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <View
                    style={[
                      styles.segment,
                      { borderColor: isDark ? "rgba(255,255,255,0.13)" : "rgba(193,208,223,0.78)" },
                    ]}
                  >
                    {/* Sliding pill indicator */}
                    <Animated.View
                      style={[
                        styles.segmentPill,
                        {
                          left: segmentPillLeft,
                          backgroundColor: isDark ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.95)",
                          borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(14,165,233,0.18)",
                        },
                      ]}
                    />
                    {/* Plan segment */}
                    <View style={styles.segmentItem}>
                      <MapPin
                        size={10}
                        color={mode === "plan" ? palette.accentLight : palette.muted}
                        strokeWidth={2.2}
                      />
                      <Animated.Text style={[styles.segmentLabel, { color: segmentLabelPlan }]}>Plan</Animated.Text>
                    </View>
                    {/* Code segment */}
                    <View style={styles.segmentItem}>
                      <Code2
                        size={10}
                        color={mode === "code" ? palette.accentLight : palette.muted}
                        strokeWidth={2.2}
                      />
                      <Animated.Text style={[styles.segmentLabel, { color: segmentLabelCode }]}>Code</Animated.Text>
                    </View>
                  </View>
                </Pressable>
              </View>

              {/* Right cluster */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {modelLabel ? (
                  <View
                    style={{
                      maxWidth: 108,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(193,208,223,0.70)",
                      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.62)",
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                    }}
                  >
                    <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }} numberOfLines={1}>
                      {modelLabel}
                    </Text>
                  </View>
                ) : null}
                {activeMcpCount > 0 ? (
                  <View
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(52,199,89,0.30)" : "rgba(34,197,94,0.22)",
                      backgroundColor: isDark ? "rgba(52,199,89,0.11)" : "rgba(34,197,94,0.08)",
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                    }}
                  >
                    <Text
                      style={{ color: palette.success, fontSize: 10, fontWeight: "800", fontVariant: ["tabular-nums"] }}
                    >
                      MCP {activeMcpCount}
                    </Text>
                  </View>
                ) : null}
                {/* Char count */}
                {showCharCount && !sending ? (
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "500",
                      color: charCount > 400 ? palette.warn : palette.muted,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {charCount}
                  </Text>
                ) : null}

                {/* Send / Stop */}
                {sending ? (
                  <Animated.View style={{ transform: [{ scale: stopPulse }] }}>
                    <Pressable
                      onPress={() => {
                        void triggerHaptic("error")
                        onStop?.()
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Stop current run"
                      hitSlop={4}
                      style={({ pressed }) => ({
                        borderRadius: 13,
                        borderWidth: 1,
                        borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.82)",
                        backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)",
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: pressed ? 0.7 : 1,
                        transform: [{ scale: pressed ? 0.93 : 1 }],
                      })}
                    >
                      <Square size={14} color={palette.ink} strokeWidth={0} fill={palette.ink} />
                    </Pressable>
                  </Animated.View>
                ) : (
                  <Animated.View style={{ transform: [{ scale: sendScaleAnim }] }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Send message"
                      accessibilityState={{ disabled: sendDisabled }}
                      disabled={sendDisabled}
                      onPress={() => {
                        void triggerHaptic("send")
                        onSend()
                      }}
                      style={({ pressed }) => ({
                        borderRadius: 13,
                        borderWidth: 1,
                        borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.82)",
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        opacity: pressed && !sendDisabled ? 0.7 : sendDisabled ? 0.5 : 1,
                        transform: [{ scale: pressed && !sendDisabled ? 0.93 : 1 }],
                      })}
                    >
                      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 13, backgroundColor: sendBg }]} />
                      <ArrowUp
                        size={20}
                        color={hasText && !sendBlocked ? (isDark ? "#0a0a0a" : "#ffffff") : palette.muted}
                        strokeWidth={2.6}
                      />
                    </Pressable>
                  </Animated.View>
                )}
              </View>
            </View>
          </View>
        </View>
      </View>

      <ComposerToolDrawer
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        modelLabel={modelLabel}
        availableModels={availableModels}
        onModelSelect={onModelSelect}
        skills={skills}
        onSkillSelect={onSkillSelect}
        onSkillsManage={onSkillsManage}
        tools={tools}
        onToolToggle={onToolToggle}
        onToolsManage={onToolsManage}
        mcpServers={mcpServers}
        onMcpToggle={onMcpToggle}
        onMcpManage={onMcpManage}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  capsule: {
    borderRadius: 24,
    overflow: "hidden",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 8,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    // SEGMENT_W * 2 segments + 4px inner padding (2 each side) = 68*2+4 = 140
    width: SEGMENT_W * 2 + 4,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  segmentPill: {
    position: "absolute",
    top: 2,
    // Pill fills one segment minus 2px (leaves 2px gap on connecting edge)
    width: SEGMENT_W - 2,
    height: 26, // 30 - 4 (2px top + 2px bottom clearance)
    borderRadius: 999,
    borderWidth: 1,
  },
  segmentItem: {
    width: SEGMENT_W,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    zIndex: 1,
  },
  segmentLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
})
