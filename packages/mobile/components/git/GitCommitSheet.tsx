import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useEffect, useRef, useState } from "react"

const ENTRANCE_CONFIG = {
  damping: 20,
  stiffness: 260,
  mass: 0.8,
}

const PRESS_CONFIG = {
  friction: 20,
  tension: 170,
}
import { AdaptiveBlur } from "@/components/GlassView"
import { ActionButton } from "@/components/ui/ActionButton"
import { TextField } from "@/components/ui/TextField"
import { GitFileTree } from "./GitFileTree"
import { GitFileStatusBadge } from "./GitFileStatusBadge"
import type { GitCommit, GitFileStatus } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

interface GitCommitSheetProps {
  visible: boolean
  branch: string
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: string[]
  onClose: () => void
  onCommit: (message: string, files: string[], amend?: boolean, amendSha?: string) => Promise<void>
  onDiscard?: (files: string[]) => void
  onStage?: (files: string[]) => void
  onUnstage?: (files: string[]) => void
}

export function GitCommitSheet({
  visible,
  branch,
  staged,
  unstaged,
  untracked,
  onClose,
  onCommit,
  onDiscard,
  onStage,
  onUnstage,
}: GitCommitSheetProps) {
  const { palette, isDark } = useAppTheme()
  const [commitMessage, setCommitMessage] = useState("")
  const [committing, setCommitting] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<"staged" | "changes">("changes")

  const allFiles: GitFileStatus[] = [
    ...staged.map((f) => ({ ...f })),
    ...unstaged.map((f) => ({ ...f })),
    ...untracked.map((path) => ({ status: "untracked" as const, path })),
  ]

  const selectedCount = selectedFiles.size
  const hasFilesToCommit = staged.length > 0 || selectedCount > 0
  const commitableFiles = tab === "staged" ? staged : allFiles

  const entranceAnim = useRef(new Animated.Value(0)).current

  interface AnimatedTabProps {
    tab: string
    active: boolean
    label: string
    isDark: boolean
    palette: { border: string; ink: string; muted: string }
    onPress: () => void
  }

  const AnimatedTab = ({ active, label, isDark, palette, onPress }: AnimatedTabProps) => {
    const pressAnim = useRef(new Animated.Value(1)).current

    return (
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          Animated.spring(pressAnim, {
            toValue: 0.96,
            ...PRESS_CONFIG,
            useNativeDriver: true,
          }).start()
        }}
        onPressOut={() => {
          Animated.spring(pressAnim, {
            toValue: 1,
            friction: 16,
            tension: 150,
            useNativeDriver: true,
          }).start()
        }}
      >
        <Animated.View
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 14,
            backgroundColor: active ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)") : "transparent",
            borderWidth: 1,
            borderColor: active ? palette.border : "transparent",
            alignItems: "center",
            transform: [{ scale: pressAnim }],
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: active ? palette.ink : palette.muted,
            }}
          >
            {label}
          </Text>
        </Animated.View>
      </Pressable>
    )
  }

  const sheetAnim = useRef(new Animated.Value(0)).current
  const backdropAnim = useRef(new Animated.Value(0)).current
  const fileItemAnims = useRef<Map<string, Animated.Value>>(new Map())

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(backdropAnim, {
          toValue: 1,
          friction: 20,
          tension: 65,
          useNativeDriver: true,
        }),
        Animated.spring(sheetAnim, {
          toValue: 1,
          ...ENTRANCE_CONFIG,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(sheetAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [visible, backdropAnim, sheetAnim])

  useEffect(() => {
    allFiles.forEach((file, index) => {
      const key = file.path
      if (!fileItemAnims.current.has(key)) {
        fileItemAnims.current.set(key, new Animated.Value(0))
      }
      const anim = fileItemAnims.current.get(key)!
      Animated.spring(anim, {
        toValue: 1,
        friction: 20,
        tension: 80,
        delay: index * 30,
        useNativeDriver: true,
      }).start()
    })
  }, [allFiles])

  const getFileItemAnim = (path: string) => fileItemAnims.current.get(path) || new Animated.Value(1)

  const createPressAnim = () => {
    const pressAnim = useRef(new Animated.Value(1)).current
    return {
      pressAnim,
      onPressIn: () => {
        Animated.spring(pressAnim, {
          toValue: 0.97,
          ...PRESS_CONFIG,
          useNativeDriver: true,
        }).start()
      },
      onPressOut: () => {
        Animated.spring(pressAnim, {
          toValue: 1,
          friction: 16,
          tension: 150,
          useNativeDriver: true,
        }).start()
      },
    }
  }

  const closePressAnim = createPressAnim()
  const commitPressAnim = createPressAnim()
  const tabChangePressAnim = createPressAnim()

  async function handleCommit() {
    if (!commitMessage.trim() || committing) return
    try {
      setCommitting(true)
      const files = selectedCount > 0 ? Array.from(selectedFiles) : staged.map((f) => f.path)
      await onCommit(commitMessage.trim(), files)
      setCommitMessage("")
      setSelectedFiles(new Set())
      onClose()
    } finally {
      setCommitting(false)
    }
  }

  function toggleFile(path: string, selected: boolean) {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (selected) {
        next.add(path)
      } else {
        next.delete(path)
      }
      return next
    })
  }

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  })

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, opacity: backdropAnim }}>
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 22 : 15}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.20)"}
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.20)" }]}
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
                  borderRadius: 34,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.82)",
                  shadowColor: "#000",
                  shadowOpacity: isDark ? 0.45 : 0.14,
                  shadowRadius: 32,
                  shadowOffset: { width: 0, height: -6 },
                  elevation: 22,
                  transform: [{ translateY: sheetTranslateY }, { scale: sheetAnim }],
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
                    Commit changes
                  </Text>
                  <Text style={{ marginTop: 8, fontSize: 28, fontWeight: "600", lineHeight: 32, color: palette.ink }}>
                    {branch}
                  </Text>

                  {/* Tabs */}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                    <AnimatedTab
                      tab="changes"
                      active={tab === "changes"}
                      label={`Changes (${unstaged.length + untracked.length})`}
                      isDark={isDark}
                      palette={palette}
                      onPress={() => setTab("changes")}
                    />
                    <AnimatedTab
                      tab="staged"
                      active={tab === "staged"}
                      label={`Staged (${staged.length})`}
                      isDark={isDark}
                      palette={palette}
                      onPress={() => setTab("staged")}
                    />
                  </View>

                  {/* File tree */}
                  <View
                    style={{
                      marginTop: 12,
                      height: 200,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: palette.border,
                      overflow: "hidden",
                    }}
                  >
                    <GitFileTree
                      files={commitableFiles}
                      selectedFiles={selectedFiles}
                      onFileSelect={toggleFile}
                      selectable={tab === "changes"}
                    />
                  </View>

                  {/* Commit message */}
                  <View style={{ marginTop: 16 }}>
                    <TextField
                      label="Commit message"
                      value={commitMessage}
                      onChangeText={setCommitMessage}
                      placeholder="Describe your changes..."
                      multiline
                    />
                  </View>

                  {/* Actions */}
                  <View style={{ marginTop: 20, flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <ActionButton label="Cancel" variant="secondary" onPress={onClose} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ActionButton
                        label={committing ? "Committing..." : "Commit"}
                        disabled={!commitMessage.trim() || !hasFilesToCommit || committing}
                        loading={committing}
                        onPress={handleCommit}
                      />
                    </View>
                  </View>
                </View>
              </Animated.View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  )
}
