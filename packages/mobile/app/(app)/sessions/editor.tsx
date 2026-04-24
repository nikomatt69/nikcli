import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Clipboard from "expo-clipboard"
import { ArrowLeft, Check, Copy, Eye, Pencil, Save } from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { EditorBreadcrumb } from "@/components/editor/EditorBreadcrumb"
import { GitFileStatusBadge } from "@/components/git/GitFileStatusBadge"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { detectLanguage, highlightCode } from "@/lib/syntax"
import { useEditorStore } from "@/lib/useEditorStore"
import type { FileNode } from "@/lib/types"

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace"
const LINE_HEIGHT = 18
const FONT_SIZE = 12.5

export default function EditorScreen() {
  const { palette, isDark } = useAppTheme()
  const { top } = useSafeAreaInsets()
  const { sessionId, filePath, absolute, directory, highlightLine } =
    useLocalSearchParams<{
      sessionId: string
      filePath: string
      absolute: string
      directory: string
      highlightLine?: string
    }>()
  const { client } = useServer()
  const { openFile, updateContent, markSaved, openFiles } = useEditorStore()

  const [mode, setMode] = useState<"view" | "edit">("view")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [gitStatus, setGitStatus] = useState<FileNode["gitStatus"]>()

  const stored = absolute ? openFiles[absolute] : undefined
  const content = stored?.content ?? ""
  const dirty = stored?.dirty ?? false

  const targetLine = highlightLine ? parseInt(highlightLine, 10) : undefined
  const scrollRef = useRef<ScrollView>(null)

  const filename = useMemo(() => (filePath ?? "").split("/").pop() ?? "file", [filePath])
  const breadcrumbSegments = useMemo(() => {
    if (!filePath || !directory) return []
    const rel = filePath
      .replace(directory.replace(/\/$/, ""), "")
      .replace(/^\//, "")
    return rel.split("/").filter(Boolean)
  }, [filePath, directory])

  const language = useMemo(() => detectLanguage(filename), [filename])

  const load = useCallback(async () => {
    if (!client || !absolute) return
    try {
      setLoading(true)
      setError(null)
      const [file, gitState] = await Promise.all([
        stored ? Promise.resolve(null) : client.readFile(absolute),
        client.getGitStatus().catch(() => null),
      ])
      if (file && file.type === "text") {
        openFile({ path: filePath ?? absolute, absolute, content: file.content })
      }
      if (gitState) {
        const all = [...(gitState.staged ?? []), ...(gitState.unstaged ?? [])]
        const entry = all.find((f) => f.path === filePath || f.path === absolute)
        if (entry) {
          setGitStatus(entry.status === "added" ? "added" : entry.status === "deleted" ? "deleted" : "modified")
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [client, absolute, filePath, stored, openFile])

  useEffect(() => {
    void load()
  }, [load])

  // Scroll to highlighted line
  useEffect(() => {
    if (!loading && targetLine && targetLine > 1) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: (targetLine - 1) * LINE_HEIGHT, animated: true })
      }, 300)
    }
  }, [loading, targetLine])

  async function save() {
    if (!client || !absolute) return
    try {
      setSaving(true)
      await client.writeFile(absolute, content)
      markSaved(absolute)
      void triggerHaptic("success")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      void triggerHaptic("error")
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    if (dirty) {
      Alert.alert("Unsaved changes", "Leave without saving?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => router.back(),
        },
        {
          text: "Save & Leave",
          onPress: async () => {
            await save()
            router.back()
          },
        },
      ])
      return
    }
    router.back()
  }

  async function copyContent() {
    await Clipboard.setStringAsync(content)
    setCopied(true)
    void triggerHaptic("selection")
    setTimeout(() => setCopied(false), 1500)
  }

  // Syntax-highlighted view
  const highlighted = useMemo(() => {
    if (mode !== "view" || !content) return null
    return highlightCode(content)
  }, [mode, content])

  // Line numbers
  const lineCount = useMemo(() => content.split("\n").length, [content])
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount],
  )

  const chromeButtonStyle = {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.82)",
    overflow: "hidden" as const,
    padding: 10,
  }

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? "#0d0d0d" : "#fafafa" }}>
      {/* Header */}
      <View
        style={{
          paddingTop: top + 8,
          paddingBottom: 10,
          paddingHorizontal: 14,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.55)",
          overflow: "hidden",
        }}
      >
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={40}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(14,14,14,0.96)" : "rgba(255,255,255,0.96)"}
          pointerEvents="none"
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {/* Back */}
          <Pressable onPress={handleBack} style={({ pressed }) => ({ ...chromeButtonStyle, opacity: pressed ? 0.7 : 1 })}>
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={44}
              style={StyleSheet.absoluteFill}
              fallbackColor={isDark ? "rgba(22,22,22,0.88)" : "rgba(255,255,255,0.88)"}
              pointerEvents="none"
            />
            <ArrowLeft size={16} color={palette.ink} strokeWidth={2.2} />
          </Pressable>

          {/* Breadcrumb */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <EditorBreadcrumb
              rootLabel={(directory ?? "").split("/").pop() ?? "root"}
              segments={breadcrumbSegments}
              onSegmentPress={(index) => {
                if (index < breadcrumbSegments.length - 1) router.back()
              }}
            />
          </View>

          {/* Git status */}
          {gitStatus && <GitFileStatusBadge status={gitStatus} compact />}

          {/* Language label */}
          <View
            style={{
              borderRadius: 8,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.6)",
              paddingHorizontal: 7,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: "700", letterSpacing: 0.8, color: palette.muted, textTransform: "uppercase" }}>
              {language}
            </Text>
          </View>

          {/* Copy */}
          <Pressable
            onPress={() => void copyContent()}
            style={({ pressed }) => ({ ...chromeButtonStyle, opacity: pressed ? 0.7 : 1 })}
          >
            <AdaptiveBlur tint={isDark ? "dark" : "light"} intensity={44} style={StyleSheet.absoluteFill} fallbackColor={isDark ? "rgba(22,22,22,0.88)" : "rgba(255,255,255,0.88)"} pointerEvents="none" />
            {copied ? (
              <Check size={16} color={palette.success ?? "#22c55e"} strokeWidth={2.2} />
            ) : (
              <Copy size={16} color={palette.ink} strokeWidth={2} />
            )}
          </Pressable>

          {/* View / Edit toggle */}
          <Pressable
            onPress={() => {
              void triggerHaptic("selection")
              setMode((m) => (m === "view" ? "edit" : "view"))
            }}
            style={({ pressed }) => ({
              ...chromeButtonStyle,
              opacity: pressed ? 0.7 : 1,
              borderColor: mode === "edit"
                ? isDark ? "rgba(14,165,233,0.45)" : "rgba(14,165,233,0.35)"
                : chromeButtonStyle.borderColor,
            })}
          >
            <AdaptiveBlur tint={isDark ? "dark" : "light"} intensity={44} style={StyleSheet.absoluteFill} fallbackColor={isDark ? "rgba(22,22,22,0.88)" : "rgba(255,255,255,0.88)"} pointerEvents="none" />
            {mode === "view" ? (
              <Pencil size={16} color={palette.ink} strokeWidth={2} />
            ) : (
              <Eye size={16} color={palette.accentLight} strokeWidth={2} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: palette.danger, fontSize: 14, textAlign: "center" }}>{error}</Text>
        </View>
      ) : mode === "view" ? (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 64 }}
          horizontal={false}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row" }}>
              {/* Line numbers */}
              <View
                style={{
                  paddingTop: 14,
                  paddingHorizontal: 10,
                  alignItems: "flex-end",
                  backgroundColor: isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.03)",
                  borderRightWidth: StyleSheet.hairlineWidth,
                  borderRightColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
                  minWidth: 42,
                }}
              >
                {lineNumbers.map((n) => (
                  <Text
                    key={n}
                    style={{
                      fontSize: FONT_SIZE,
                      lineHeight: LINE_HEIGHT,
                      color:
                        n === targetLine
                          ? palette.accentLight
                          : isDark
                            ? "rgba(255,255,255,0.22)"
                            : "rgba(0,0,0,0.25)",
                      fontFamily: MONO,
                    }}
                  >
                    {n}
                  </Text>
                ))}
              </View>

              {/* Highlighted code */}
              <Text
                selectable
                style={{
                  paddingTop: 14,
                  paddingHorizontal: 14,
                  fontFamily: MONO,
                  fontSize: FONT_SIZE,
                  lineHeight: LINE_HEIGHT,
                }}
              >
                {highlighted?.map((seg, i) => (
                  <Text key={i} style={{ color: seg.color }}>
                    {seg.text}
                  </Text>
                ))}
              </Text>
            </View>
          </ScrollView>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 80 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", minWidth: "100%" }}>
                {/* Line numbers */}
                <View
                  style={{
                    paddingTop: 14,
                    paddingHorizontal: 10,
                    alignItems: "flex-end",
                    backgroundColor: isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.03)",
                    borderRightWidth: StyleSheet.hairlineWidth,
                    borderRightColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
                    minWidth: 42,
                  }}
                  pointerEvents="none"
                >
                  {lineNumbers.map((n) => (
                    <Text
                      key={n}
                      style={{
                        fontSize: FONT_SIZE,
                        lineHeight: LINE_HEIGHT,
                        color: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.25)",
                        fontFamily: MONO,
                      }}
                    >
                      {n}
                    </Text>
                  ))}
                </View>

                {/* TextInput */}
                <TextInput
                  value={content}
                  onChangeText={(text) => updateContent(absolute, text)}
                  multiline
                  scrollEnabled={false}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  keyboardAppearance={isDark ? "dark" : "light"}
                  style={{
                    flex: 1,
                    paddingTop: 14,
                    paddingHorizontal: 14,
                    fontFamily: MONO,
                    fontSize: FONT_SIZE,
                    lineHeight: LINE_HEIGHT,
                    color: isDark ? "#e5e5e5" : "#1a1a1a",
                    textAlignVertical: "top",
                    minHeight: lineCount * LINE_HEIGHT + 28,
                  }}
                  selectionColor={palette.accent}
                />
              </View>
            </ScrollView>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Floating Save button */}
      {dirty && (
        <View
          style={{
            position: "absolute",
            bottom: 24,
            right: 16,
          }}
        >
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: isDark ? "rgba(14,165,233,0.35)" : "rgba(14,165,233,0.25)",
              backgroundColor: isDark ? palette.accent : palette.accent,
              paddingHorizontal: 16,
              paddingVertical: 10,
              opacity: pressed || saving ? 0.75 : 1,
              shadowColor: palette.accent,
              shadowOpacity: 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            })}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Save size={14} color="#fff" strokeWidth={2.2} />
            )}
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}
