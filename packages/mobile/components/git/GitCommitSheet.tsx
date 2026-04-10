import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useState } from "react"
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

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
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
              <View
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
                    <Pressable
                      onPress={() => setTab("changes")}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 14,
                        backgroundColor:
                          tab === "changes" ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)") : "transparent",
                        borderWidth: 1,
                        borderColor: tab === "changes" ? palette.border : "transparent",
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color: tab === "changes" ? palette.ink : palette.muted,
                        }}
                      >
                        Changes ({unstaged.length + untracked.length})
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setTab("staged")}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 14,
                        backgroundColor:
                          tab === "staged" ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)") : "transparent",
                        borderWidth: 1,
                        borderColor: tab === "staged" ? palette.border : "transparent",
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color: tab === "staged" ? palette.ink : palette.muted,
                        }}
                      >
                        Staged ({staged.length})
                      </Text>
                    </Pressable>
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
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
