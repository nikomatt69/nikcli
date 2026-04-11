import { useEffect, useRef, useState } from "react"
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { ActionButton } from "@/components/ui/ActionButton"
import { useAppTheme } from "@/lib/theme"

const MAX_LENGTH = 120

type Props = {
  visible: boolean
  currentTitle: string
  saving: boolean
  onClose(): void
  onSave(title: string): void
}

export function SessionRenameSheet({ visible, currentTitle, saving, onClose, onSave }: Props) {
  const { palette, isDark } = useAppTheme()
  const [title, setTitle] = useState(currentTitle)
  const inputRef = useRef<TextInput>(null)
  const translateY = useRef(new Animated.Value(80)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const cancelScaleAnim = useRef(new Animated.Value(1)).current
  const saveScaleAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, damping: 20, stiffness: 260, mass: 0.8, useNativeDriver: true }),
        Animated.spring(opacityAnim, { toValue: 1, damping: 18, stiffness: 280, mass: 0.85, useNativeDriver: true }),
      ]).start()
    } else {
      translateY.setValue(80)
      opacityAnim.setValue(0)
    }
  }, [visible])

  const trimmed = title.trim()
  const disabled = !trimmed || trimmed === currentTitle.trim()
  const overLimit = title.length > MAX_LENGTH

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        setTitle(currentTitle)
        requestAnimationFrame(() => inputRef.current?.focus())
      }}
    >
      <View style={{ flex: 1 }}>
        {/* Full-screen blur backdrop */}
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 22 : 15}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.20)"}
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.74)" : "rgba(15,23,42,0.24)" }]}
        />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />

          {/* Glass card */}
          <Animated.View
            style={{
              marginHorizontal: 16,
              marginBottom: Platform.OS === "ios" ? 28 : 16,
              overflow: "hidden",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.82)",
              shadowColor: "#000",
              shadowOpacity: isDark ? 0.45 : 0.16,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: -4 },
              elevation: 14,
              transform: [{ translateY }],
              opacity: opacityAnim,
            }}
          >
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={isDark ? 92 : 80}
              style={StyleSheet.absoluteFill}
              fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(17,17,17,0.68)" : "rgba(255,255,255,0.62)" },
              ]}
              pointerEvents="none"
            />

            {/* Header */}
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 24,
                paddingBottom: 16,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(193,208,223,0.7)",
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  letterSpacing: 1.8,
                  textTransform: "uppercase",
                  color: palette.accentLight,
                }}
              >
                Rename session
              </Text>
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 22,
                  fontWeight: "700",
                  lineHeight: 26,
                  letterSpacing: -0.4,
                  color: palette.ink,
                }}
              >
                Set a new title
              </Text>
              {currentTitle ? (
                <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: palette.soft }} numberOfLines={1}>
                  Current: {currentTitle}
                </Text>
              ) : null}
            </View>

            {/* Input */}
            <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
              <Text
                style={{
                  marginBottom: 10,
                  fontSize: 11,
                  fontWeight: "600",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: palette.muted,
                }}
              >
                New title
              </Text>

              <View
                style={{
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(14,165,233,0.24)",
                  backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(14,165,233,0.04)",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
              >
                <TextInput
                  ref={inputRef}
                  value={title}
                  onChangeText={(t) => setTitle(t.slice(0, MAX_LENGTH))}
                  placeholder="Enter a session title…"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (!disabled && !saving && !overLimit) onSave(trimmed)
                  }}
                  style={{
                    fontSize: 16,
                    fontWeight: "500",
                    letterSpacing: -0.2,
                    color: palette.ink,
                    padding: 0,
                    margin: 0,
                  }}
                />
              </View>

              <View
                style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
              >
                <Text style={{ fontSize: 12, lineHeight: 16, color: palette.soft }}>
                  {title.length > 0 ? `${trimmed.length} characters` : "Start typing a title"}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    lineHeight: 16,
                    color: overLimit ? palette.danger : palette.muted,
                  }}
                >
                  {title.length}/{MAX_LENGTH}
                </Text>
              </View>
            </View>

            {/* Actions */}
            <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingBottom: 28, paddingTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={onClose}
                  disabled={saving}
                  onPressIn={() =>
                    Animated.spring(cancelScaleAnim, {
                      toValue: 0.94,
                      damping: 20,
                      stiffness: 300,
                      useNativeDriver: true,
                    }).start()
                  }
                  onPressOut={() =>
                    Animated.spring(cancelScaleAnim, {
                      toValue: 1,
                      damping: 20,
                      stiffness: 300,
                      useNativeDriver: true,
                    }).start()
                  }
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.94 : cancelScaleAnim }],
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <ActionButton label="Cancel" variant="secondary" onPress={() => {}} disabled={saving} />
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={() => onSave(trimmed)}
                  disabled={disabled || saving || overLimit}
                  onPressIn={() =>
                    Animated.spring(saveScaleAnim, {
                      toValue: 0.94,
                      damping: 20,
                      stiffness: 300,
                      useNativeDriver: true,
                    }).start()
                  }
                  onPressOut={() =>
                    Animated.spring(saveScaleAnim, {
                      toValue: 1,
                      damping: 20,
                      stiffness: 300,
                      useNativeDriver: true,
                    }).start()
                  }
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.94 : saveScaleAnim }],
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <ActionButton
                    label={saving ? "Saving…" : "Save"}
                    disabled={true}
                    loading={saving}
                    onPress={() => {}}
                  />
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
