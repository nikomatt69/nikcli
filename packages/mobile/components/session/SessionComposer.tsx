import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  type LayoutChangeEvent,
  type KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { ArrowUp, Code2, Lock, MapPin, Paperclip, Square } from "lucide-react-native"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type SessionComposerProps = {
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
  onHeightChange?(height: number): void
}

const CHAR_COUNT_THRESHOLD = 100
const SEGMENT_W = 68

const composerTokens = {
  sheetRadius: 25,
  shellInset: 12,
  shellPaddingX: 15,
  shellPaddingTop: 15,
  shellPaddingBottom: 15,
  shellGap: 10,
  inputFontSize: 14,
  inputLineHeight: 18,
  inputMinHeight: 22,
  inputMaxHeight: 108,
  actionSize: 34,
  sendSize: 78,
  actionRadius: 20,
  panelRadius: 18,
  clusterGap: 8,
} as const

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
  onHeightChange,
}: SessionComposerProps) {
  const { palette, isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const [isFocused, setIsFocused] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)

  const sendBlocked = sessionBlocked || cleaned || !input.trim()
  const sendDisabled = sending || sendBlocked
  const showSlash = input.trimStart().startsWith("/")
  const hasText = input.trim().length > 0
  const charCount = input.length
  const showCharCount = charCount > CHAR_COUNT_THRESHOLD
  const showStatus = sessionBlocked || cleaned

  const focusAnim = useRef(new Animated.Value(0)).current
  const stopPulse = useRef(new Animated.Value(1)).current
  const modeAnim = useRef(new Animated.Value(mode === "code" ? 1 : 0)).current
  const slashAnim = useRef(new Animated.Value(0)).current
  const statusAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: isFocused ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
      easing: Easing.out(Easing.ease),
    }).start()
  }, [isFocused, focusAnim])

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

  useEffect(() => {
    const updateKeyboardInset = (nextInset: number, event?: KeyboardEvent) => {
      if (Platform.OS === "ios" && event) {
        Keyboard.scheduleLayoutAnimation(event)
      }
      setKeyboardInset(nextInset)
    }

    const handleKeyboardFrame = (event: KeyboardEvent) => {
      updateKeyboardInset(Math.max(event.endCoordinates.height - insets.bottom, 0), event)
    }

    const handleKeyboardHide = (event: KeyboardEvent) => {
      updateKeyboardInset(0, event)
    }

    const frameSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      handleKeyboardFrame,
    )
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      handleKeyboardHide,
    )

    return () => {
      frameSub.remove()
      hideSub.remove()
    }
  }, [insets.bottom])

  const surfaces = useMemo(
    () => ({
      shell: isDark ? palette.userBubble : palette.surface,
      panel: isDark ? palette.panel : palette.surface,
      action: isDark ? palette.assistantBubble : palette.panel,
      actionBorder: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.64)",
      shellBorder: isDark ? "rgba(255,255,255,0.09)" : "rgba(193,208,223,0.76)",
      focusBorder: isDark ? "rgba(255,255,255,0.22)" : "rgba(14,165,233,0.30)",
      pressed: isDark ? "rgba(255,255,255,0.05)" : "rgba(13,27,42,0.04)",
      accentTint: isDark ? "rgba(255,255,255,0.10)" : "rgba(14,165,233,0.08)",
    }),
    [isDark, palette],
  )

  const borderColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [surfaces.shellBorder, surfaces.focusBorder],
  })

  const segmentPillLeft = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, SEGMENT_W + 2],
  })

  const segmentLabelPlan = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.accentLight, palette.muted],
  })

  const segmentLabelCode = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.muted, palette.accentLight],
  })

  const slashTranslateY = slashAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] })
  const statusTranslateY = statusAnim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] })

  const placeholder = cleaned
    ? "Worktree cleaned up"
    : mode === "plan"
      ? "What would you like to plan?"
      : "Reply to Nikcli..."

  const modeDescription = mode === "plan" ? "Structured reasoning first" : "Direct execution ready"

  const iconBtn = useMemo(
    () => ({
      borderRadius: 999,
      borderWidth: 1,
      borderColor: surfaces.actionBorder,
      backgroundColor: surfaces.action,
    }),
    [surfaces],
  )

  const handleLayout = (event: LayoutChangeEvent) => {
    onHeightChange?.(event.nativeEvent.layout.height)
  }

  return (
    <View>
      {showStatus && (
        <Animated.View
          style={{
            opacity: statusAnim,
            transform: [{ translateY: statusTranslateY }],
            marginHorizontal: composerTokens.shellInset,
            marginBottom: 10,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: composerTokens.panelRadius,
              borderWidth: 1,
              borderColor: surfaces.actionBorder,
              backgroundColor: cleaned
                ? isDark
                  ? "rgba(143,143,143,0.07)"
                  : "rgba(220,38,38,0.06)"
                : isDark
                  ? "rgba(183,183,183,0.07)"
                  : "rgba(217,119,6,0.07)",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
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
                {cleaned ? "Read-only worktree" : "Processing..."}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={{ flexShrink: 1, marginLeft: 8, fontSize: 11, color: palette.soft, textAlign: "right" }}
            >
              {modeDescription}
            </Text>
          </View>
        </Animated.View>
      )}

      {showSlash && (
        <Animated.View
          style={{
            opacity: slashAnim,
            transform: [{ translateY: slashTranslateY }],
            marginHorizontal: composerTokens.shellInset,
            marginBottom: 10,
          }}
        >
          <View
            style={{
              borderRadius: composerTokens.panelRadius,
              borderWidth: 1,
              borderColor: surfaces.actionBorder,
              backgroundColor: surfaces.panel,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 14,
                paddingTop: 12,
                paddingBottom: 10,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: surfaces.actionBorder,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  color: palette.soft,
                }}
              >
                Commands
              </Text>
              {slashLoading && <ActivityIndicator size="small" color={palette.accent} />}
            </View>

            {slashSuggestions.length ? (
              slashSuggestions.slice(0, 5).map((item, index) => (
                <Pressable
                  key={item.name}
                  onPress={() => {
                    void triggerHaptic("selection")
                    onSelectSlash(item.name)
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "flex-start",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    backgroundColor: pressed ? surfaces.pressed : "transparent",
                    borderBottomWidth: index < Math.min(slashSuggestions.length, 5) - 1 ? StyleSheet.hairlineWidth : 0,
                    borderBottomColor: surfaces.actionBorder,
                  })}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: surfaces.accentTint,
                      marginRight: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "700",
                        color: palette.accentLight,
                        lineHeight: 16,
                      }}
                    >
                      /
                    </Text>
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: palette.ink, fontSize: 13.5, fontWeight: "600", letterSpacing: -0.1 }}>
                      {item.name}
                    </Text>
                    {item.description ? (
                      <Text
                        style={{ color: palette.soft, fontSize: 11.5, marginTop: 2, lineHeight: 16 }}
                        numberOfLines={2}
                      >
                        {item.description}
                      </Text>
                    ) : null}
                  </View>

                  {item.badge ? (
                    <View
                      style={{
                        backgroundColor: surfaces.accentTint,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: surfaces.actionBorder,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        marginLeft: 10,
                      }}
                    >
                      <Text style={{ color: palette.accentLight, fontSize: 10, fontWeight: "700", letterSpacing: 0.4 }}>
                        {item.badge}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ))
            ) : !slashLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 18 }}>
                <Text style={{ color: palette.soft, fontSize: 13, fontWeight: "500" }}>No matching commands</Text>
              </View>
            ) : null}
          </View>
        </Animated.View>
      )}

      <Animated.View
        onLayout={handleLayout}
        style={[
          styles.shell,
          {
            marginTop: 4,
            borderColor,
            backgroundColor: surfaces.shell,
            paddingBottom: composerTokens.shellPaddingBottom + Math.max(insets.bottom, 10) + keyboardInset,
          },
        ]}
      >
        <View style={styles.bodyRow}>
          <View style={styles.mainColumn}>
            <View style={styles.inputBlock}>
              <TextInput
                value={input}
                onChangeText={setInput}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                multiline
                editable={!cleaned}
                selectionColor={palette.accent}
                keyboardAppearance={isDark ? "dark" : "light"}
                returnKeyType="default"
                placeholder={placeholder}
                placeholderTextColor={palette.muted}
                style={[styles.input, { color: palette.ink, fontWeight: input.length ? "500" : "400" }]}
              />
            </View>

            <View style={styles.controlsRow}>
              <View style={styles.leftCluster}>
                {onAttach ? (
                  <Pressable
                    onPress={() => {
                      void triggerHaptic("selection")
                      Keyboard.dismiss()
                      onAttach()
                    }}
                    disabled={cleaned}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      ...iconBtn,
                      width: composerTokens.actionSize,
                      height: composerTokens.actionSize,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: cleaned ? 0.32 : pressed ? 0.68 : 1,
                      transform: [{ scale: pressed ? 0.94 : 1 }],
                    })}
                  >
                    <Paperclip size={15} color={palette.accentLight} strokeWidth={2} />
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => {
                    void triggerHaptic("selection")
                    Keyboard.dismiss()
                    onOpenCommands()
                  }}
                  hitSlop={6}
                  style={({ pressed }) => ({
                    ...iconBtn,
                    height: composerTokens.actionSize,
                    borderRadius: 17,
                    minWidth: 88,
                    paddingHorizontal: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.68 : 1,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "700",
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      color: palette.accentLight,
                    }}
                  >
                    Commands
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    void triggerHaptic("selection")
                    setMode(mode === "plan" ? "code" : "plan")
                  }}
                  hitSlop={4}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.78 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <View
                    style={[styles.segment, { borderColor: surfaces.actionBorder, backgroundColor: surfaces.action }]}
                  >
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
                    <View style={styles.segmentItem}>
                      <MapPin
                        size={10}
                        color={mode === "plan" ? palette.accentLight : palette.muted}
                        strokeWidth={2.2}
                      />
                      <Animated.Text style={[styles.segmentLabel, { color: segmentLabelPlan }]}>Plan</Animated.Text>
                    </View>
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

              {showCharCount && !sending ? (
                <Text
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: "500",
                    color: charCount > 400 ? palette.warn : palette.soft,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {charCount}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.sendRail}>
            <Animated.View style={sending ? { transform: [{ scale: stopPulse }] } : undefined}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={sendDisabled}
                onPress={() => {
                  if (sending) {
                    void triggerHaptic("error")
                    return
                  }

                  void triggerHaptic("send")
                  onSend()
                }}
                hitSlop={4}
                style={({ pressed }) => ({
                  width: composerTokens.sendSize,
                  height: composerTokens.sendSize,
                  borderRadius: 999,
                  borderWidth: isDark ? 1 : 1.5,
                  borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(206,220,237,0.98)",
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.99)",
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: isDark ? palette.shadow : "rgba(189,207,229,1)",
                  shadowOpacity: isDark ? 0.08 : 0.18,
                  shadowRadius: isDark ? 4 : 10,
                  shadowOffset: { width: 0, height: isDark ? 1 : 2 },
                  opacity: pressed && !sendDisabled ? 0.7 : sendDisabled ? 0.5 : 1,
                  transform: [{ scale: pressed && !sendDisabled ? 0.93 : 1 }],
                })}
              >
                {sending ? (
                  <Square size={16} color={palette.ink} strokeWidth={0} fill={palette.ink} />
                ) : hasText && !sendBlocked ? (
                  <ArrowUp size={28} color={palette.ink} strokeWidth={2.25} />
                ) : (
                  <ArrowUp size={28} color={palette.muted} strokeWidth={2.25} />
                )}
              </Pressable>
            </Animated.View>
          </View>
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    borderTopLeftRadius: composerTokens.sheetRadius,
    borderTopRightRadius: composerTokens.sheetRadius,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: composerTokens.shellPaddingX,
    paddingTop: composerTokens.shellPaddingTop,
    gap: composerTokens.shellGap,
  },
  bodyRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  mainColumn: {
    flex: 1,
    minWidth: 0,
    gap: composerTokens.shellGap,
  },
  inputBlock: {
    minHeight: composerTokens.inputMinHeight,
  },
  input: {
    fontSize: composerTokens.inputFontSize,
    lineHeight: composerTokens.inputLineHeight,
    minHeight: composerTokens.inputMinHeight,
    maxHeight: composerTokens.inputMaxHeight,
    paddingHorizontal: 0,
    paddingTop: 1,
    paddingBottom: 3,
    margin: 0,
    textAlignVertical: "top",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: composerTokens.actionSize,
  },
  leftCluster: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    gap: composerTokens.clusterGap,
  },
  sendRail: {
    width: composerTokens.sendSize,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: composerTokens.actionSize,
    width: SEGMENT_W * 2 + 4,
    position: "relative",
    overflow: "hidden",
  },
  segmentPill: {
    position: "absolute",
    top: 2,
    width: SEGMENT_W - 2,
    height: composerTokens.actionSize - 4,
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
