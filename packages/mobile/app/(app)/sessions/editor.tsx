import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
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
import { CaseSensitive, Undo2, WrapText } from "lucide-react-native"
import * as Clipboard from "expo-clipboard"
import * as SecureStore from "expo-secure-store"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  FileSearch,
  Pencil,
  Save,
  Search,
  X,
} from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { ActionSheet, ActionSheetDivider, ActionSheetItem, useActionSheetRef } from "@/components/BottomSheet"
import { SkeletonBox } from "@/components/Skeleton"
import { EditorBreadcrumb } from "@/components/editor/EditorBreadcrumb"
import { FileSearchSheet } from "@/components/editor/FileSearchSheet"
import { GitFileStatusBadge } from "@/components/git/GitFileStatusBadge"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { detectLanguage, highlightCode, DRACULA, type Segment } from "@/lib/syntax"
import { PRESS_SPRING, useStaggeredAnimation, getAnimatedStyle } from "@/lib/animation"
import { useEditorStore } from "@/lib/useEditorStore"
import type { FileNode } from "@/lib/types"

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace"
const LINE_HEIGHT = 18
const FONT_SIZE = 12.5
const RECENT_SEARCHES_KEY = "editor_recent_searches"
const MAX_RECENT_SEARCHES = 5
const LARGE_FILE_CHAR_LIMIT = 250_000
const LARGE_FILE_LINE_LIMIT = 5_000

// Light-mode syntax color overrides
const LIGHT_SYNTAX: Record<string, string> = {
  [DRACULA.keyword]: "#d946a8",
  [DRACULA.string]: "#16a34a",
  [DRACULA.comment]: "#8b9bb4",
  [DRACULA.builtin]: "#c2410c",
  [DRACULA.number]: "#7c3aed",
  [DRACULA.operator]: "#0284c7",
  [DRACULA.foreground]: "#1a1a1a",
  [DRACULA.muted]: "#61768c",
}

export default function EditorScreen() {
  const { palette, isDark } = useAppTheme()
  const { top, bottom } = useSafeAreaInsets()
  const { sessionId, filePath, absolute, directory, highlightLine } = useLocalSearchParams<{
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
  const [findOpen, setFindOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [activeFindIndex, setActiveFindIndex] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])

  const stored = absolute ? openFiles[absolute] : undefined
  const content = stored?.content ?? ""
  const dirty = stored?.dirty ?? false

  const targetLine = highlightLine ? parseInt(highlightLine, 10) : undefined
  const scrollRef = useRef<ScrollView>(null)
  const editInputRef = useRef<TextInput>(null)

  // ── Animation refs ─────────────────────────────────────────────
  const unsavedSheetRef = useActionSheetRef()
  const contentAnims = useStaggeredAnimation(2, 80)
  const findBarAnim = useRef(new Animated.Value(0)).current
  const backScale = useRef(new Animated.Value(1)).current
  const findScale = useRef(new Animated.Value(1)).current
  const fileSearchScale = useRef(new Animated.Value(1)).current
  const copyScale = useRef(new Animated.Value(1)).current
  const modeScale = useRef(new Animated.Value(1)).current
  const wrapScale = useRef(new Animated.Value(1)).current
  const saveScale = useRef(new Animated.Value(1)).current
  // Local toggle animation with useNativeDriver:false for color interpolation
  const modeProgress = useRef(new Animated.Value(mode === "edit" ? 1 : 0)).current
  useEffect(() => {
    Animated.spring(modeProgress, {
      toValue: mode === "edit" ? 1 : 0,
      damping: 18,
      stiffness: 200,
      mass: 0.5,
      useNativeDriver: false,
    }).start()
  }, [mode, modeProgress])

  const filename = useMemo(() => (filePath ?? "").split("/").pop() ?? "file", [filePath])
  const breadcrumbSegments = useMemo(() => {
    if (!filePath || !directory) return []
    const rel = filePath.replace(directory.replace(/\/$/, ""), "").replace(/^\//, "")
    return rel.split("/").filter(Boolean)
  }, [filePath, directory])

  const language = useMemo(() => detectLanguage(filename), [filename])
  const findMatches = useMemo(() => {
    const query = findQuery.trim()
    if (!query) return []
    const lines = content.split("\n")
    if (caseSensitive) {
      return lines.map((line, index) => ({ line, lineNumber: index + 1 })).filter((item) => item.line.includes(query))
    }
    const lowerQuery = query.toLowerCase()
    return lines
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter((item) => item.line.toLowerCase().includes(lowerQuery))
  }, [content, findQuery, caseSensitive])
  const activeFindLine = findMatches[activeFindIndex]?.lineNumber

  const charCount = useMemo(() => content.length, [content])
  const wordCount = useMemo(() => (content.trim() ? content.trim().split(/\s+/).length : 0), [content])
  const lineCount = useMemo(() => content.split("\n").length, [content])
  const isLargeFile = content.length > LARGE_FILE_CHAR_LIMIT || lineCount > LARGE_FILE_LINE_LIMIT

  // Find bar toggle animation
  useEffect(() => {
    Animated.spring(findBarAnim, {
      toValue: findOpen ? 1 : 0,
      damping: 20,
      stiffness: 260,
      mass: 0.7,
      useNativeDriver: true,
    }).start()
  }, [findOpen, findBarAnim])

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
    void (async () => {
      try {
        const storedSearches = await SecureStore.getItemAsync(RECENT_SEARCHES_KEY)
        if (storedSearches) {
          const parsed = JSON.parse(storedSearches)
          if (Array.isArray(parsed)) setRecentSearches(parsed)
        }
      } catch {
        // ignore
      }
    })()
  }, [load])

  // Scroll to highlighted line
  useEffect(() => {
    if (!loading && targetLine && targetLine > 1) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: (targetLine - 1) * LINE_HEIGHT, animated: true })
      }, 300)
    }
  }, [loading, targetLine])

  useEffect(() => {
    setActiveFindIndex(0)
  }, [findQuery])

  function saveRecentSearch(query: string) {
    if (!query.trim()) return
    setRecentSearches((prev) => {
      const updated = [query, ...prev.filter((s) => s !== query)].slice(0, MAX_RECENT_SEARCHES)
      void SecureStore.setItemAsync(RECENT_SEARCHES_KEY, JSON.stringify(updated))
      return updated
    })
  }

  useEffect(() => {
    if (!loading && activeFindLine) {
      scrollRef.current?.scrollTo({ y: Math.max(0, (activeFindLine - 2) * LINE_HEIGHT), animated: true })
    }
  }, [activeFindLine, loading])

  function moveFind(delta: number) {
    if (!findMatches.length) return
    void triggerHaptic("selection")
    setActiveFindIndex((index) => (index + delta + findMatches.length) % findMatches.length)
  }

  function handleUndo() {
    if (!absolute) return
    editInputRef.current?.focus()
    void triggerHaptic("selection")
  }

  function openFind() {
    void triggerHaptic("selection")
    setFindOpen(true)
    if (findQuery.trim()) {
      saveRecentSearch(findQuery)
    }
  }

  function openWorkspaceSearch() {
    void triggerHaptic("selection")
    setFileSearchOpen(true)
  }

  function openSearchResult(file: string, line: number) {
    const nextAbsolute = file.startsWith("/") ? file : directory ? `${directory.replace(/\/$/, "")}/${file}` : file
    router.push({
      pathname: "/sessions/editor" as never,
      params: {
        sessionId,
        filePath: file,
        absolute: nextAbsolute,
        directory: directory ?? "",
        highlightLine: String(line),
      },
    })
  }

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
      unsavedSheetRef.current?.present()
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

  // Syntax-highlighted view with light-mode color remapping, grouped by line
  const highlightedLines = useMemo(() => {
    if (mode !== "view" || !content || isLargeFile) return null
    const segments = highlightCode(content)
    const mapped = isDark
      ? segments
      : segments.map((seg) => ({ text: seg.text, color: LIGHT_SYNTAX[seg.color] ?? seg.color }))
    // Split into lines for performant rendering (avoids thousands of nested Text children)
    const lines: Array<Segment[]> = []
    let current: Segment[] = []
    for (const seg of mapped) {
      const parts = seg.text.split("\n")
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push(current)
          current = []
        }
        if (parts[i]) current.push({ ...seg, text: parts[i] })
      }
    }
    if (current.length || content.endsWith("\n")) lines.push(current)
    return lines
  }, [mode, content, isDark, isLargeFile])

  // Line numbers
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount])

  // ── Shared chrome button style ─────────────────────────────────
  const chromeButtonBase = {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.82)",
    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)",
    overflow: "hidden" as const,
    paddingHorizontal: 10,
    paddingVertical: 8,
  }

  function renderChromeButton(
    scaleRef: Animated.Value,
    icon: React.ReactNode,
    onPress: () => void,
    opts?: { active?: boolean; activeBg?: string; activeBorder?: string; label?: string },
  ) {
    const isActive = opts?.active ?? false
    return (
      <Animated.View style={{ transform: [{ scale: scaleRef }] }}>
        <Pressable
          onPress={onPress}
          onPressIn={() => Animated.spring(scaleRef, { toValue: 0.93, ...PRESS_SPRING }).start()}
          onPressOut={() => Animated.spring(scaleRef, { toValue: 1, ...PRESS_SPRING }).start()}
          accessibilityRole="button"
          accessibilityLabel={opts?.label}
          style={{
            ...chromeButtonBase,
            backgroundColor: isActive
              ? (opts?.activeBg ?? (isDark ? "rgba(14,165,233,0.15)" : "rgba(14,165,233,0.10)"))
              : chromeButtonBase.backgroundColor,
            borderColor: isActive ? (opts?.activeBorder ?? palette.accent) : chromeButtonBase.borderColor,
          }}
        >
          {icon}
        </Pressable>
      </Animated.View>
    )
  }

  // ── Line number renderer with accent pill ──────────────────────
  function renderLineNumbers(nums: number[], highlights: (number | undefined)[]) {
    return (
      <View
        style={{
          paddingTop: 14,
          paddingHorizontal: 10,
          alignItems: "flex-end",
          backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
          minWidth: 42,
        }}
      >
        {nums.map((n) => {
          const isActive = highlights.includes(n)
          return (
            <View
              key={n}
              style={{
                backgroundColor: isActive
                  ? isDark
                    ? "rgba(14,165,233,0.12)"
                    : "rgba(14,165,233,0.08)"
                  : "transparent",
                borderRadius: 4,
                paddingHorizontal: isActive ? 4 : 0,
                marginHorizontal: isActive ? -4 : 0,
              }}
            >
              <Text
                style={{
                  fontSize: FONT_SIZE,
                  lineHeight: LINE_HEIGHT,
                  fontFamily: MONO,
                  fontWeight: isActive ? "600" : "400",
                  color: isActive ? palette.accentLight : isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.25)",
                }}
              >
                {n}
              </Text>
            </View>
          )
        })}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? "#000000" : "#f1f6fb" }}>
      {/* ── Header with glass treatment ── */}
      <Animated.View style={getAnimatedStyle(contentAnims[0])}>
        <View
          style={{
            paddingTop: top + 8,
            paddingBottom: 10,
            paddingHorizontal: 14,
            overflow: "hidden",
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(193,208,223,0.8)",
          }}
        >
          {/* Layer 1: Full-width glass background */}
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 90 : 80}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(241,246,251,0.80)"}
            pointerEvents="none"
          />
          {/* Layer 2: Semi-transparent overlay */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? "rgba(0,0,0,0.32)" : "rgba(241,246,251,0.22)" },
            ]}
            pointerEvents="none"
          />

          {/* Inner glass card */}
          <View
            style={{
              overflow: "hidden",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.80)",
              padding: 12,
            }}
          >
            {/* Inner glass fill */}
            <AdaptiveBlur
              tint={isDark ? "dark" : "extraLight"}
              intensity={isDark ? 55 : 45}
              style={StyleSheet.absoluteFill}
              fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              pointerEvents="none"
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(24,24,24,0.52)" : "rgba(255,255,255,0.48)" },
              ]}
              pointerEvents="none"
            />

            {/* Bottom gradient */}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: 24,
                backgroundColor: isDark ? "rgba(255,255,255,0.015)" : "rgba(232,240,248,0.14)",
              }}
              pointerEvents="none"
            />

            {/* ── Top row: back, breadcrumb, actions ── */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {renderChromeButton(
                backScale,
                <ArrowLeft size={16} color={palette.ink} strokeWidth={2.2} />,
                handleBack,
                { label: "Go back" },
              )}

              {/* Breadcrumb with git status */}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <EditorBreadcrumb
                    rootLabel={(directory ?? "").split("/").pop() ?? "root"}
                    segments={breadcrumbSegments}
                    onSegmentPress={(index) => {
                      if (index < breadcrumbSegments.length - 1) router.back()
                    }}
                  />
                  {gitStatus && <GitFileStatusBadge status={gitStatus} compact />}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 }}>
                  <View
                    style={{
                      borderRadius: 5,
                      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 9,
                        fontWeight: "700",
                        letterSpacing: 0.6,
                        color: palette.muted,
                        textTransform: "uppercase",
                      }}
                    >
                      {language}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, color: palette.muted, fontVariant: ["tabular-nums"] }}>
                    {lineCount}L · {charCount}C
                  </Text>
                </View>
              </View>

              {/* Action buttons */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {renderChromeButton(
                  fileSearchScale,
                  <FileSearch size={16} color={palette.ink} strokeWidth={2} />,
                  openWorkspaceSearch,
                  { label: "Search workspace files" },
                )}
                {renderChromeButton(
                  wrapScale,
                  <WrapText size={16} color={wordWrap ? palette.accentLight : palette.ink} strokeWidth={2} />,
                  () => setWordWrap((v) => !v),
                  { active: wordWrap, label: "Toggle word wrap" },
                )}
                {renderChromeButton(
                  findScale,
                  <Search size={16} color={findOpen ? palette.accentLight : palette.ink} strokeWidth={2} />,
                  openFind,
                  { active: findOpen, label: "Find in file" },
                )}
                {renderChromeButton(
                  copyScale,
                  copied ? (
                    <Check size={16} color={palette.success ?? "#22c55e"} strokeWidth={2.2} />
                  ) : (
                    <Copy size={16} color={palette.ink} strokeWidth={2} />
                  ),
                  () => void copyContent(),
                  { label: "Copy file content" },
                )}

                {/* View / Edit toggle with animated colors */}
                <Animated.View style={{ transform: [{ scale: modeScale }] }}>
                  <Pressable
                    onPress={() => {
                      void triggerHaptic("selection")
                      if (isLargeFile && mode === "view") return
                      const nextMode = mode === "view" ? "edit" : "view"
                      setMode(nextMode)
                      if (nextMode === "edit") setTimeout(() => editInputRef.current?.focus(), 100)
                    }}
                    onPressIn={() => Animated.spring(modeScale, { toValue: 0.93, ...PRESS_SPRING }).start()}
                    onPressOut={() => Animated.spring(modeScale, { toValue: 1, ...PRESS_SPRING }).start()}
                    accessibilityRole="button"
                    accessibilityLabel={mode === "view" ? "Switch to edit mode" : "Switch to view mode"}
                  >
                    <Animated.View
                      style={{
                        borderRadius: 8,
                        borderWidth: 1,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        overflow: "hidden",
                        borderColor: modeProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [
                            isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.82)",
                            isDark ? "rgba(14,165,233,0.45)" : "rgba(14,165,233,0.35)",
                          ],
                        }),
                        backgroundColor: modeProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [
                            isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)",
                            isDark ? "rgba(14,165,233,0.12)" : "rgba(14,165,233,0.10)",
                          ],
                        }),
                      }}
                    >
                      {mode === "view" ? (
                        <Pencil size={16} color={isLargeFile ? palette.muted : palette.ink} strokeWidth={2} />
                      ) : (
                        <Eye size={16} color={palette.accentLight} strokeWidth={2} />
                      )}
                    </Animated.View>
                  </Pressable>
                </Animated.View>
              </View>
            </View>

            {/* ── Find bar (animated) ── */}
            {findOpen ? (
              <Animated.View
                style={{
                  opacity: findBarAnim,
                  transform: [{ translateY: findBarAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
                  marginTop: 10,
                }}
                pointerEvents="auto"
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.65)",
                    overflow: "hidden",
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                  }}
                >
                  <AdaptiveBlur
                    tint={isDark ? "dark" : "light"}
                    intensity={40}
                    style={StyleSheet.absoluteFill}
                    fallbackColor={isDark ? "rgba(20,20,20,0.92)" : "rgba(255,255,255,0.92)"}
                    pointerEvents="none"
                  />
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.15)" },
                    ]}
                    pointerEvents="none"
                  />
                  <Pressable onPress={() => setCaseSensitive((v) => !v)} hitSlop={6} style={{ padding: 2 }}>
                    <CaseSensitive size={14} color={caseSensitive ? palette.accent : palette.muted} strokeWidth={2.1} />
                  </Pressable>
                  <Search size={14} color={palette.muted} strokeWidth={2.1} />
                  <TextInput
                    value={findQuery}
                    onChangeText={setFindQuery}
                    placeholder="Find in current file"
                    placeholderTextColor={palette.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardAppearance={isDark ? "dark" : "light"}
                    onSubmitEditing={() => saveRecentSearch(findQuery)}
                    style={{ flex: 1, color: palette.ink, fontSize: 13, fontFamily: MONO, paddingVertical: 0 }}
                  />
                  <Text
                    style={{ color: palette.muted, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}
                  >
                    {findMatches.length ? `${activeFindIndex + 1}/${findMatches.length}` : "0/0"}
                  </Text>
                  <Pressable onPress={() => moveFind(-1)} disabled={!findMatches.length} hitSlop={6}>
                    <ChevronUp size={15} color={findMatches.length ? palette.ink : palette.muted} strokeWidth={2.3} />
                  </Pressable>
                  <Pressable onPress={() => moveFind(1)} disabled={!findMatches.length} hitSlop={6}>
                    <ChevronDown size={15} color={findMatches.length ? palette.ink : palette.muted} strokeWidth={2.3} />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setFindQuery("")
                      setFindOpen(false)
                    }}
                    hitSlop={6}
                  >
                    <X size={15} color={palette.muted} strokeWidth={2.3} />
                  </Pressable>
                </View>
              </Animated.View>
            ) : null}
          </View>
        </View>
      </Animated.View>

      {/* ── Body ── */}
      <Animated.View style={[{ flex: 1 }, getAnimatedStyle(contentAnims[1])]}>
        {loading ? (
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View
              style={{
                paddingTop: 14,
                paddingHorizontal: 10,
                alignItems: "flex-end",
                backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                borderRightWidth: StyleSheet.hairlineWidth,
                borderRightColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                minWidth: 42,
                gap: 6,
              }}
            >
              {Array.from({ length: 18 }).map((_, i) => (
                <SkeletonBox key={i} width={i < 9 ? 8 : 16} height={FONT_SIZE} borderRadius={3} />
              ))}
            </View>
            <View style={{ flex: 1, paddingTop: 14, paddingHorizontal: 14, gap: 6 }}>
              {Array.from({ length: 18 }).map((_, i) => {
                const widths = [72, 85, 55, 45, 62, 90, 40, 78, 68, 50, 82, 38, 70, 58, 88, 42, 75, 60]
                return (
                  <SkeletonBox
                    key={i}
                    width={`${widths[i]}%`}
                    height={FONT_SIZE}
                    borderRadius={3}
                    style={{ marginLeft: i % 3 === 0 ? 24 : 0 }}
                  />
                )
              })}
            </View>
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
            {isLargeFile ? (
              <View
                style={{
                  margin: 12,
                  padding: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(245,158,11,0.30)" : "rgba(217,119,6,0.24)",
                  backgroundColor: isDark ? "rgba(245,158,11,0.10)" : "rgba(245,158,11,0.08)",
                }}
              >
                <Text style={{ color: isDark ? "#fbbf24" : "#b45309", fontSize: 12, fontWeight: "700" }}>
                  Large file mode
                </Text>
                <Text style={{ color: palette.muted, fontSize: 11, marginTop: 3 }}>
                  Syntax highlighting and editing are disabled for files over {LARGE_FILE_LINE_LIMIT.toLocaleString()}{" "}
                  lines or {LARGE_FILE_CHAR_LIMIT.toLocaleString()} characters.
                </Text>
              </View>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row" }}>
                {renderLineNumbers(lineNumbers, [targetLine, activeFindLine])}
                <View style={{ paddingTop: 14, paddingHorizontal: 14 }}>
                  {isLargeFile ? (
                    <Text
                      selectable
                      style={{
                        fontFamily: MONO,
                        fontSize: FONT_SIZE,
                        lineHeight: LINE_HEIGHT,
                        color: isDark ? "#e5e5e5" : "#1a1a1a",
                      }}
                    >
                      {content}
                    </Text>
                  ) : (
                    highlightedLines?.map((lineSegs, lineIndex) => (
                      <Text
                        key={lineIndex}
                        selectable
                        style={{
                          fontFamily: MONO,
                          fontSize: FONT_SIZE,
                          lineHeight: LINE_HEIGHT,
                          flexWrap: wordWrap ? "wrap" : undefined,
                        }}
                      >
                        {lineSegs.map((seg, i) => (
                          <Text key={i} style={{ color: seg.color }}>
                            {seg.text}
                          </Text>
                        ))}
                      </Text>
                    ))
                  )}
                </View>
              </View>
            </ScrollView>
          </ScrollView>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 80 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", minWidth: "100%" }}>
                  <View pointerEvents="none">{renderLineNumbers(lineNumbers, [activeFindLine])}</View>
                  <TextInput
                    ref={editInputRef}
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
      </Animated.View>

      {/* ── Bottom bar with glass treatment ── */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          paddingBottom: bottom + 10,
          overflow: "hidden",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(193,208,223,0.8)",
        }}
      >
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 80 : 70}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(241,246,251,0.80)"}
          pointerEvents="none"
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.28)" : "rgba(241,246,251,0.22)" }]}
          pointerEvents="none"
        />
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            backgroundColor: isDark ? "rgba(255,255,255,0.015)" : "rgba(232,240,248,0.14)",
          }}
          pointerEvents="none"
        />

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={{ fontSize: 11, color: palette.muted, fontWeight: "500" }}>
              {lineCount}L · {charCount}C · {wordCount}W
            </Text>
            <Text style={{ fontSize: 11, color: palette.muted, fontWeight: "500" }}>{language}</Text>
            {dirty && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} />}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {dirty && (
              <Animated.View style={{ transform: [{ scale: saveScale }] }}>
                <Pressable
                  onPress={() => void save()}
                  disabled={saving}
                  onPressIn={() => {
                    if (!saving) Animated.spring(saveScale, { toValue: 0.95, ...PRESS_SPRING }).start()
                  }}
                  onPressOut={() => {
                    Animated.spring(saveScale, { toValue: 1, ...PRESS_SPRING }).start()
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: isDark ? "rgba(14,165,233,0.35)" : "rgba(14,165,233,0.25)",
                    overflow: "hidden",
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Save changes"
                >
                  <AdaptiveBlur
                    tint={isDark ? "dark" : "light"}
                    intensity={40}
                    style={StyleSheet.absoluteFill}
                    fallbackColor={isDark ? "rgba(14,165,233,0.15)" : "rgba(14,165,233,0.10)"}
                    pointerEvents="none"
                  />
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: isDark ? "rgba(14,165,233,0.06)" : "rgba(14,165,233,0.04)" },
                    ]}
                    pointerEvents="none"
                  />
                  {saving ? (
                    <ActivityIndicator size="small" color={palette.accentLight} />
                  ) : (
                    <Save size={14} color={palette.accentLight} strokeWidth={2.2} />
                  )}
                  <Text style={{ color: palette.accentLight, fontSize: 12, fontWeight: "700" }}>
                    {saving ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
              </Animated.View>
            )}
          </View>
        </View>
      </View>

      {/* ── Unsaved changes ActionSheet ── */}
      <ActionSheet ref={unsavedSheetRef} snapPoints={[260]}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: palette.ink, marginBottom: 4 }}>Unsaved changes</Text>
          <Text style={{ fontSize: 12, color: palette.soft }}>You have unsaved edits. What would you like to do?</Text>
        </View>
        <ActionSheetDivider />
        <ActionSheetItem
          icon="save"
          label="Save & Leave"
          onPress={async () => {
            unsavedSheetRef.current?.dismiss()
            await save()
            router.back()
          }}
        />
        <ActionSheetItem
          icon="trash"
          label="Leave without saving"
          destructive
          onPress={() => {
            unsavedSheetRef.current?.dismiss()
            router.back()
          }}
        />
        <ActionSheetItem
          icon="x"
          label="Cancel"
          onPress={() => {
            unsavedSheetRef.current?.dismiss()
          }}
        />
      </ActionSheet>

      <FileSearchSheet visible={fileSearchOpen} onClose={() => setFileSearchOpen(false)} onSelect={openSearchResult} />
    </View>
  )
}
