import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import type { Dispatch, SetStateAction } from "react"
import { useEffect, useRef } from "react"
import { AdaptiveBlur } from "@/components/GlassView"
import type { SessionDetail } from "@/lib/types"
import { ActionButton } from "@/components/ui/ActionButton"
import { TextField } from "@/components/ui/TextField"
import { useAppTheme } from "@/lib/theme"

type PublishSheetProps = {
  visible: boolean
  detail: SessionDetail | null
  publishTitle: string
  setPublishTitle: Dispatch<SetStateAction<string>>
  publishBody: string
  setPublishBody: Dispatch<SetStateAction<string>>
  commitMessage: string
  setCommitMessage: Dispatch<SetStateAction<string>>
  publishing: boolean
  sessionBlocked: boolean
  cleaned: boolean
  onClose(): void
  onPublish(): void
}

export function PublishSheet({
  visible,
  detail,
  publishTitle,
  setPublishTitle,
  publishBody,
  setPublishBody,
  commitMessage,
  setCommitMessage,
  publishing,
  sessionBlocked,
  cleaned,
  onClose,
  onPublish,
}: PublishSheetProps) {
  const { palette, isDark } = useAppTheme()
  const translateYRef = useRef<Animated.Value | null>(null)
  if (translateYRef.current === null) translateYRef.current = new Animated.Value(100)
  const translateY = translateYRef.current
  const opacityAnimRef = useRef<Animated.Value | null>(null)
  if (opacityAnimRef.current === null) opacityAnimRef.current = new Animated.Value(0)
  const opacityAnim = opacityAnimRef.current
  const cancelScaleAnimRef = useRef<Animated.Value | null>(null)
  if (cancelScaleAnimRef.current === null) cancelScaleAnimRef.current = new Animated.Value(1)
  const cancelScaleAnim = cancelScaleAnimRef.current
  const publishScaleAnimRef = useRef<Animated.Value | null>(null)
  if (publishScaleAnimRef.current === null) publishScaleAnimRef.current = new Animated.Value(1)
  const publishScaleAnim = publishScaleAnimRef.current
  const pulseAnimRef = useRef<Animated.Value | null>(null)
  if (pulseAnimRef.current === null) pulseAnimRef.current = new Animated.Value(1)
  const pulseAnim = pulseAnimRef.current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, damping: 20, stiffness: 240, mass: 0.85, useNativeDriver: true }),
        Animated.spring(opacityAnim, { toValue: 1, damping: 18, stiffness: 280, mass: 0.8, useNativeDriver: true }),
      ]).start()
    } else {
      translateY.setValue(100)
      opacityAnim.setValue(0)
    }
  }, [visible])

  useEffect(() => {
    if (publishing) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      )
      pulse.start()
      return () => pulse.stop()
    } else {
      pulseAnim.setValue(1)
    }
  }, [publishing])

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        {/* Full-screen blur backdrop */}
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 22 : 15}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(0,0,0,0.72)" : "rgba(20,20,19,0.20)"}
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(20,20,19,0.20)" }]}
        />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "flex-end",
              paddingHorizontal: 16,
              paddingBottom: 24,
            }}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
            <ScrollView
              style={{ width: "100%", maxHeight: "88%" }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
            >
              <Animated.View
                style={{
                  overflow: "hidden",
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.82)",
                  shadowColor: "#000",
                  shadowOpacity: isDark ? 0.45 : 0.14,
                  shadowRadius: 32,
                  shadowOffset: { width: 0, height: -6 },
                  elevation: 22,
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

                <View style={{ padding: 20 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: palette.accentLight,
                    }}
                  >
                    Publish workflow
                  </Text>
                  <Text
                    style={{
                      marginTop: 8,
                      fontSize: 28,
                      fontWeight: "600",
                      lineHeight: 32,
                      color: palette.ink,
                    }}
                  >
                    {detail?.info.github?.pullRequest ? "Update pull request" : "Create pull request"}
                  </Text>
                  <Text style={{ marginTop: 12, fontSize: 14, lineHeight: 24, color: palette.soft }}>
                    {detail?.info.github?.pullRequest
                      ? "Update the branch and commit message. Existing PR title and description stay in GitHub unless you edit them here."
                      : "Set the commit, PR title, and launch notes before this session publishes back to GitHub from mobile."}
                  </Text>

                  <View style={{ marginTop: 16, gap: 12 }}>
                    <TextField
                      label="Commit message"
                      value={commitMessage}
                      onChangeText={setCommitMessage}
                      placeholder="Commit message"
                    />
                    {!detail?.info.github?.pullRequest ? (
                      <>
                        <TextField
                          label="Pull request title"
                          value={publishTitle}
                          onChangeText={setPublishTitle}
                          placeholder="Pull request title"
                        />
                        <TextField
                          label="Pull request body"
                          value={publishBody}
                          onChangeText={setPublishBody}
                          multiline
                          placeholder="Pull request body"
                        />
                      </>
                    ) : null}
                  </View>

                  <View style={{ marginTop: 20, flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Pressable
                        onPress={onClose}
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
                        <ActionButton label="Cancel" variant="secondary" onPress={() => {}} />
                      </Pressable>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Pressable
                        onPress={onPublish}
                        disabled={publishing || sessionBlocked || cleaned}
                        onPressIn={() =>
                          Animated.spring(publishScaleAnim, {
                            toValue: 0.94,
                            damping: 20,
                            stiffness: 300,
                            useNativeDriver: true,
                          }).start()
                        }
                        onPressOut={() =>
                          Animated.spring(publishScaleAnim, {
                            toValue: 1,
                            damping: 20,
                            stiffness: 300,
                            useNativeDriver: true,
                          }).start()
                        }
                        style={({ pressed }) => ({
                          transform: [{ scale: pressed ? 0.94 : publishScaleAnim }],
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <ActionButton label="Publish now" disabled={true} onPress={() => {}} />
                      </Pressable>
                    </View>
                  </View>

                  {publishing ? (
                    <Animated.View
                      style={{
                        marginTop: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        transform: [{ scale: pulseAnim }],
                      }}
                    >
                      <ActivityIndicator color={palette.accent} size="small" />
                      <Text style={{ fontSize: 14, color: palette.soft }}>Publishing changes to GitHub…</Text>
                    </Animated.View>
                  ) : null}
                </View>
              </Animated.View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
