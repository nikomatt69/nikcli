import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Circle, GitBranch, GitCommit, History, Layers, RefreshCw } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { GitFileTree } from "./GitFileTree"
import { GitLineDiffEditor } from "./GitLineDiffEditor"
import { ActionButton } from "@/components/ui/ActionButton"
import type { GitBranchInfo, GitFileStatus, GitState, ParsedFileDiff } from "@/lib/types"

type TabType = "changes" | "graph" | "review"

function createPressAnim() {
  const pressAnim = new Animated.Value(1)
  return {
    onPressIn: () => {
      Animated.spring(pressAnim, {
        toValue: 0.97,
        friction: 20,
        tension: 170,
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
    scaleAnim: pressAnim,
  }
}

interface GitReviewModalProps {
  visible: boolean
  onClose: () => void
  sessionID: string
  directory?: string
  github?: {
    owner: string
    repo: string
    baseBranch: string
    headBranch: string
    pullRequest?: { number: number; url: string; title: string }
  }
  onCommit: (message: string, files: string[], options?: { stagedOnly?: boolean }) => Promise<void>
  onPublish?: () => void
}

interface CommitItem {
  sha: string
  message: string
  author: string
  timestamp: number
  additions: number
  deletions: number
  filesCount: number
  isHead: boolean
}

function MetricPill({ label, value, color }: { label: string; value: number; color: string }) {
  const { palette, isDark } = useAppTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(218,216,209,0.80)",
        backgroundColor: isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.72)",
        paddingHorizontal: 10,
        paddingVertical: 7,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: color }} />
      <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Text style={{ color: palette.soft, fontSize: 10, fontWeight: "600" }}>{label}</Text>
    </View>
  )
}

function MiniGitButton({
  label,
  tone = "neutral",
  disabled,
  onPress,
}: {
  label: string
  tone?: "neutral" | "good" | "danger"
  disabled?: boolean
  onPress(): void
}) {
  const { palette, isDark } = useAppTheme()
  const color = tone === "good" ? palette.success : tone === "danger" ? palette.danger : palette.accentLight
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 38,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: disabled ? palette.border : isDark ? `${color}55` : `${color}35`,
        backgroundColor: disabled
          ? isDark
            ? "rgba(255,255,255,0.035)"
            : "rgba(255,255,255,0.56)"
          : isDark
            ? `${color}1F`
            : `${color}14`,
        opacity: disabled ? 0.48 : pressed ? 0.74 : 1,
        transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
      })}
    >
      <Text style={{ color: disabled ? palette.muted : color, fontSize: 11, fontWeight: "800" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

function BranchPill({ branch, onPress }: { branch: GitBranchInfo; onPress?: () => void }) {
  const { palette, isDark } = useAppTheme()
  const active = branch.isCurrent
  const content = (
    <>
      <GitBranch size={12} color={active ? palette.accentLight : palette.muted} strokeWidth={2.2} />
      <Text style={{ color: active ? palette.ink : palette.soft, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>
        {branch.name.replace(/^remotes\//, "")}
      </Text>
      {branch.aheadBy > 0 || branch.behindBy > 0 ? (
        <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
          {branch.aheadBy ? `+${branch.aheadBy}` : ""}
          {branch.behindBy ? ` -${branch.behindBy}` : ""}
        </Text>
      ) : null}
    </>
  )

  if (active || !onPress) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? palette.accent : palette.border,
          backgroundColor: active
            ? isDark
              ? "rgba(255,255,255,0.16)"
              : "rgba(20,20,19,0.10)"
            : isDark
              ? "rgba(255,255,255,0.04)"
              : "rgba(255,255,255,0.64)",
          paddingHorizontal: 10,
          paddingVertical: 7,
        }}
      >
        {content}
      </View>
    )
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Switch to branch ${branch.name}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.64)",
        paddingHorizontal: 10,
        paddingVertical: 7,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      {content}
    </Pressable>
  )
}

export function GitReviewModal({
  visible,
  onClose,
  sessionID,
  directory,
  github,
  onCommit,
  onPublish,
}: GitReviewModalProps) {
  const { palette, isDark } = useAppTheme()
  const { top, bottom } = useSafeAreaInsets()
  const [tab, setTab] = useState<TabType>("changes")
  const [loading, setLoading] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [gitState, setGitState] = useState<GitState | null>(null)
  const [commits, setCommits] = useState<CommitItem[]>([])
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [diffFiles, setDiffFiles] = useState<ParsedFileDiff[]>([])
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [commitMessage, setCommitMessage] = useState("")
  const [gitAction, setGitAction] = useState<"stage" | "unstage" | "discard" | "commit" | "push" | "checkout" | null>(
    null,
  )

  const resolveGitClient = useCallback(async () => {
    const { getMobileClient } = await import("@/lib/client")
    const client = await getMobileClient()
    if (!client) return null
    return directory ? client.withDirectory(directory) : client
  }, [directory])

  const entranceAnimRef = useRef<Animated.Value | null>(null)
  if (entranceAnimRef.current === null) entranceAnimRef.current = new Animated.Value(0)
  const entranceAnim = entranceAnimRef.current
  const contentFadeAnimRef = useRef<Animated.Value | null>(null)
  if (contentFadeAnimRef.current === null) contentFadeAnimRef.current = new Animated.Value(1)
  const contentFadeAnim = contentFadeAnimRef.current
  const tabSlideAnimRef = useRef<Animated.Value | null>(null)
  if (tabSlideAnimRef.current === null) tabSlideAnimRef.current = new Animated.Value(0)
  const tabSlideAnim = tabSlideAnimRef.current
  const commitItemAnims = useRef<Map<string, Animated.Value>>(new Map())

  useEffect(() => {
    if (visible) {
      contentFadeAnim.setValue(0)
      Animated.parallel([
        Animated.spring(entranceAnim, {
          toValue: 1,
          friction: 18,
          tension: 65,
          useNativeDriver: true,
        }),
        Animated.timing(contentFadeAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      entranceAnim.setValue(0)
    }
  }, [visible, entranceAnim, contentFadeAnim])

  const handleTabChange = (newTab: TabType) => {
    const newIndex = tabs.findIndex((t) => t.id === newTab)
    const currentIndex = tabs.findIndex((t) => t.id === tab)

    // Animate tab indicator slide
    Animated.spring(tabSlideAnim, {
      toValue: newIndex,
      friction: 20,
      tension: 160,
      useNativeDriver: true,
    }).start()

    Animated.sequence([
      Animated.timing(contentFadeAnim, {
        toValue: 0,
        duration: 100,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(contentFadeAnim, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start()
    setTab(newTab)
  }

  const getCommitItemAnim = (sha: string) => {
    if (!commitItemAnims.current.has(sha)) {
      commitItemAnims.current.set(sha, new Animated.Value(0))
    }
    return commitItemAnims.current.get(sha)!
  }

  useEffect(() => {
    commits.forEach((commit, index) => {
      const anim = getCommitItemAnim(commit.sha)
      Animated.spring(anim, {
        toValue: 1,
        friction: 20,
        tension: 80,
        delay: index * 50,
        useNativeDriver: true,
      }).start()
    })
  }, [commits])

  const headerAnimStyle = {
    opacity: entranceAnim,
    transform: [
      {
        translateY: entranceAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [-20, 0],
        }),
      },
    ],
  }

  const contentAnimStyle = {
    opacity: contentFadeAnim,
  }

  const closeButtonAnim = createPressAnim()
  const refreshButtonAnim = createPressAnim()
  const stageAllAnim = createPressAnim()

  const fetchGitData = useCallback(async () => {
    setLoading(true)
    try {
      const client = await resolveGitClient()
      if (!client) return

      const [state, commitsData, branchData, unstagedDiffs, stagedDiffs] = await Promise.all([
        client.getGitStatus().catch(() => null),
        client.getGitCommits(20).catch(() => []),
        client.getGitBranches().catch(() => []),
        client.getGitDiff().catch(() => []),
        client.getGitDiff({ staged: true }).catch(() => []),
      ])

      setGitState(state)
      setCommits(
        commitsData.map((c, index) => ({
          sha: c.sha,
          message: c.message,
          author: c.author.name,
          timestamp: c.timestamp,
          additions: c.additions,
          deletions: c.deletions,
          filesCount: c.filesCount,
          isHead: index === 0,
        })),
      )
      setBranches(branchData)
      setDiffFiles([
        ...stagedDiffs.map((diff) => ({ ...diff, stage: "staged" as const })),
        ...unstagedDiffs.map((diff) => ({ ...diff, stage: "unstaged" as const })),
      ])
    } catch (error) {
      console.error("Failed to fetch git data:", error)
    } finally {
      setLoading(false)
    }
  }, [resolveGitClient])

  useEffect(() => {
    if (visible) {
      void fetchGitData()
    }
  }, [visible, fetchGitData, refreshKey])

  function handleRefresh() {
    setRefreshKey((k) => k + 1)
  }

  function handleFileSelect(path: string) {
    setSelectedFile(path)
    const index = diffFiles.findIndex((file) => file.file === path || file.oldPath === path)
    if (index >= 0) setActiveFileIndex(index)
    setTab("review")
  }

  function toggleFileSelection(path: string, selected: boolean) {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (selected) next.add(path)
      else next.delete(path)
      return next
    })
  }

  async function handleStageAll() {
    if (!gitState) return
    const allPaths = [...gitState.unstaged.map((f) => f.path), ...gitState.untracked]
    if (!allPaths.length) return
    const client = await resolveGitClient()
    if (!client) return
    try {
      setGitAction("stage")
      await client.stageGitFiles(allPaths)
      void triggerHaptic("selection")
      void handleRefresh()
    } catch (error) {
      console.error("Failed to stage files:", error)
    } finally {
      setGitAction(null)
    }
  }

  const stagedPaths = useMemo(() => new Set(gitState?.staged.map((file) => file.path) ?? []), [gitState?.staged])
  const worktreePaths = useMemo(
    () => new Set([...(gitState?.unstaged.map((file) => file.path) ?? []), ...(gitState?.untracked ?? [])]),
    [gitState?.unstaged, gitState?.untracked],
  )
  const selectedPaths = useMemo(() => Array.from(selectedFiles), [selectedFiles])
  const selectedWorktreePaths = useMemo(
    () => selectedPaths.filter((path) => worktreePaths.has(path)),
    [selectedPaths, worktreePaths],
  )
  const selectedStagedPaths = useMemo(
    () => selectedPaths.filter((path) => stagedPaths.has(path)),
    [selectedPaths, stagedPaths],
  )

  async function stageSelectedOrAll() {
    if (!gitState) return
    const paths = selectedWorktreePaths.length ? selectedWorktreePaths : [...worktreePaths]
    if (!paths.length) return
    const client = await resolveGitClient()
    if (!client) return
    try {
      setGitAction("stage")
      await client.stageGitFiles(paths)
      setSelectedFiles(new Set())
      void triggerHaptic("selection")
      await fetchGitData()
    } catch (error) {
      console.error("Failed to stage files:", error)
      void triggerHaptic("error")
    } finally {
      setGitAction(null)
    }
  }

  async function unstageSelectedOrAll() {
    if (!gitState) return
    const paths = selectedStagedPaths.length ? selectedStagedPaths : [...stagedPaths]
    if (!paths.length) return
    const client = await resolveGitClient()
    if (!client) return
    try {
      setGitAction("unstage")
      await client.unstageGitFiles(paths)
      setSelectedFiles(new Set())
      void triggerHaptic("selection")
      await fetchGitData()
    } catch (error) {
      console.error("Failed to unstage files:", error)
      void triggerHaptic("error")
    } finally {
      setGitAction(null)
    }
  }

  function confirmDiscardSelected() {
    const paths = selectedWorktreePaths.filter((path) => !(gitState?.untracked ?? []).includes(path))
    if (!paths.length) return
    Alert.alert(
      "Discard selected changes?",
      "This restores tracked files from HEAD. Untracked files are left untouched.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void discardFiles(paths)
          },
        },
      ],
    )
  }

  async function discardFiles(paths: string[]) {
    const client = await resolveGitClient()
    if (!client) return
    try {
      setGitAction("discard")
      await client.discardGitFiles(paths)
      setSelectedFiles(new Set())
      void triggerHaptic("selection")
      await fetchGitData()
    } catch (error) {
      console.error("Failed to discard files:", error)
      void triggerHaptic("error")
    } finally {
      setGitAction(null)
    }
  }

  async function checkoutBranch(branch: GitBranchInfo) {
    if (branch.isCurrent || gitAction) return
    const branchName = branch.name.replace(/^remotes\/origin\//, "").replace(/^remotes\//, "")
    const client = await resolveGitClient()
    if (!client) return
    try {
      setGitAction("checkout")
      await client.checkoutGitBranch(branchName)
      void triggerHaptic("success")
      await fetchGitData()
    } catch (error) {
      console.error("Failed to checkout branch:", error)
      void triggerHaptic("error")
    } finally {
      setGitAction(null)
    }
  }

  async function commitAndPush() {
    const staged = gitState?.staged ?? []
    const message = commitMessage.trim()
    if (!message || !staged.length || committing) return
    const client = await resolveGitClient()
    if (!client) return
    try {
      setCommitting(true)
      setGitAction("commit")
      await onCommit(
        message,
        staged.map((file) => file.path),
        { stagedOnly: true },
      )
      setGitAction("push")
      await client.pushGitBranch(gitState?.branch)
      setCommitMessage("")
      setSelectedFiles(new Set())
      void triggerHaptic("success")
      await fetchGitData()
    } catch (error) {
      console.error("Failed to commit and push:", error)
      void triggerHaptic("error")
    } finally {
      setGitAction(null)
      setCommitting(false)
    }
  }

  const totalChanges =
    (gitState?.staged.length ?? 0) + (gitState?.unstaged.length ?? 0) + (gitState?.untracked.length ?? 0)
  const hasStagedChanges = (gitState?.staged.length ?? 0) > 0

  // Tab configuration
  const tabs = [
    { id: "changes" as TabType, label: "Changes", icon: Layers, count: totalChanges },
    { id: "graph" as TabType, label: "Commits", icon: GitCommit, count: commits.length },
    { id: "review" as TabType, label: "Review", icon: GitBranch, count: diffFiles.length },
  ]
  const tabIndex = tabs.findIndex((t) => t.id === tab)

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Animated.View style={[{ flex: 1, backgroundColor: palette.background }, headerAnimStyle]}>
        {/* Header */}
        <View
          style={{
            paddingTop: top + 8,
            paddingBottom: 0,
            backgroundColor: isDark ? palette.surface : palette.background,
          }}
        >
          {/* Top row: back, title, actions */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 }}>
            <Animated.View style={{ transform: [{ scale: closeButtonAnim.scaleAnim }] }}>
              <Pressable
                onPress={onClose}
                onPressIn={closeButtonAnim.onPressIn}
                onPressOut={closeButtonAnim.onPressOut}
                style={({ pressed }) => ({
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <ArrowLeft size={18} color={palette.ink} strokeWidth={2.2} />
              </Pressable>
            </Animated.View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: palette.ink, letterSpacing: -0.3 }}>
                Review Changes
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                {github ? (
                  <>
                    <Text style={{ fontSize: 12, color: palette.soft }}>
                      {github.owner}/{github.repo}
                    </Text>
                    <Text style={{ fontSize: 10, color: palette.muted }}>·</Text>
                    <Text style={{ fontSize: 12, color: palette.accentLight, fontWeight: "600" }}>
                      {github.baseBranch} → {github.headBranch}
                    </Text>
                  </>
                ) : (
                  <Text style={{ fontSize: 12, color: palette.soft }}>Local repository</Text>
                )}
              </View>
            </View>
            <Animated.View style={{ transform: [{ scale: refreshButtonAnim.scaleAnim }] }}>
              <Pressable
                onPress={handleRefresh}
                onPressIn={refreshButtonAnim.onPressIn}
                onPressOut={refreshButtonAnim.onPressOut}
                style={({ pressed }) => ({
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
                accessibilityRole="button"
                accessibilityLabel="Refresh"
              >
                <RefreshCw size={16} color={palette.ink} strokeWidth={2.2} />
              </Pressable>
            </Animated.View>
          </View>

          {/* Elegant sliding tabs */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <View
              style={{
                flexDirection: "row",
                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                borderRadius: 14,
                padding: 4,
              }}
            >
              {/* Tab indicator - equidistant spacing */}
              {tabs.map((item, index) => {
                const isActive = tab === item.id
                const Icon = item.icon
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => handleTabChange(item.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    style={({ pressed }) => ({
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 10,
                      marginHorizontal: 2,
                      borderRadius: 11,
                      backgroundColor: isActive ? palette.accent : "transparent",
                      opacity: pressed && !isActive ? 0.7 : 1,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={15} color={isActive ? "#fff" : palette.soft} strokeWidth={2.2} />
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "700",
                          color: isActive ? "#fff" : palette.soft,
                          marginLeft: 6,
                        }}
                      >
                        {item.label}
                      </Text>
                      <View
                        style={{
                          minWidth: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: isActive
                            ? "rgba(255,255,255,0.25)"
                            : isDark
                              ? "rgba(255,255,255,0.12)"
                              : "rgba(0,0,0,0.1)",
                          alignItems: "center",
                          justifyContent: "center",
                          marginLeft: 6,
                          paddingHorizontal: 5,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: "800",
                            color: isActive ? "#fff" : palette.muted,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {item.count}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          </View>

          {/* Bottom info bar */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.border,
              backgroundColor: isDark ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.5)",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" }} />
                <Text style={{ fontSize: 11, color: palette.soft, fontWeight: "600" }}>
                  {gitState?.staged.length ?? 0} staged
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} />
                <Text style={{ fontSize: 11, color: palette.soft, fontWeight: "600" }}>
                  {gitState?.unstaged.length ?? 0} changed
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#64748b" }} />
                <Text style={{ fontSize: 11, color: palette.soft, fontWeight: "600" }}>
                  {gitState?.untracked.length ?? 0} new
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 11, color: palette.muted }}>{gitState?.branch || "No branch"}</Text>
              {gitState && (gitState.commitsAhead > 0 || gitState.commitsBehind > 0) && (
                <Text style={{ fontSize: 10, color: palette.accentLight, fontWeight: "600" }}>
                  {gitState.commitsAhead > 0 ? `+${gitState.commitsAhead}` : ""}
                  {gitState.commitsBehind > 0 ? ` -${gitState.commitsBehind}` : ""}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Content */}
        <Animated.View style={[{ flex: 1 }, contentAnimStyle]}>
          {/* Changes Tab */}
          {tab === "changes" && (
            <View style={{ flex: 1 }}>
              {/* Stats bar */}
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: palette.border,
                  gap: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        letterSpacing: 1.4,
                        color: palette.accentLight,
                        textTransform: "uppercase",
                      }}
                    >
                      {gitState?.branch || "Git worktree"}
                    </Text>
                    <Text style={{ marginTop: 2, fontSize: 12, color: palette.soft }}>
                      {gitState?.commitsAhead ?? 0} ahead · {gitState?.commitsBehind ?? 0} behind · {selectedFiles.size}{" "}
                      selected
                    </Text>
                  </View>
                  {gitAction ? <ActivityIndicator size="small" color={palette.accent} /> : null}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <MetricPill label="Staged" value={gitState?.staged.length ?? 0} color="#22c55e" />
                  <MetricPill label="Changed" value={gitState?.unstaged.length ?? 0} color="#f59e0b" />
                  <MetricPill label="Untracked" value={gitState?.untracked.length ?? 0} color="#64748b" />
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <MiniGitButton
                    label={selectedWorktreePaths.length ? "Stage Selected" : "Stage All"}
                    tone="good"
                    disabled={!worktreePaths.size || gitAction !== null}
                    onPress={() => void stageSelectedOrAll()}
                  />
                  <MiniGitButton
                    label={selectedStagedPaths.length ? "Unstage Selected" : "Unstage All"}
                    disabled={!stagedPaths.size || gitAction !== null}
                    onPress={() => void unstageSelectedOrAll()}
                  />
                  <MiniGitButton
                    label="Discard"
                    tone="danger"
                    disabled={!selectedWorktreePaths.length || gitAction !== null}
                    onPress={confirmDiscardSelected}
                  />
                </View>
              </View>

              {/* File tree */}
              <View style={{ flex: 1 }}>
                <GitFileTree
                  files={
                    [
                      ...(gitState?.staged ?? []),
                      ...(gitState?.unstaged ?? []),
                      ...(gitState?.untracked ?? []).map((path) => ({ status: "untracked" as const, path })),
                    ] as GitFileStatus[]
                  }
                  onFilePress={handleFileSelect}
                  selectedFiles={selectedFiles}
                  onFileSelect={toggleFileSelection}
                  selectable
                />
              </View>

              {/* Bottom actions */}
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  paddingBottom: bottom + 12,
                  borderTopWidth: 1,
                  borderTopColor: palette.border,
                  backgroundColor: isDark ? palette.surface : palette.background,
                }}
              >
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {github && (
                    <View style={{ flex: 1 }}>
                      <ActionButton label="Publish PR" onPress={onPublish ?? (() => {})} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      label="Review & Commit"
                      variant={hasStagedChanges ? "primary" : "secondary"}
                      disabled={!hasStagedChanges}
                      onPress={() => handleTabChange("graph")}
                    />
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Graph Tab */}
          {tab === "graph" && (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottom + 20 }}
              contentInsetAdjustmentBehavior="automatic"
            >
              <View
                style={{
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.72)",
                  padding: 14,
                  gap: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(20,20,19,0.10)",
                    }}
                  >
                    <GitCommit size={17} color={palette.accentLight} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "800",
                        letterSpacing: 1.4,
                        color: palette.accentLight,
                        textTransform: "uppercase",
                      }}
                    >
                      Commit pipeline
                    </Text>
                    <Text style={{ marginTop: 2, fontSize: 12, color: palette.soft }}>
                      {hasStagedChanges
                        ? `${gitState?.staged.length ?? 0} staged files ready`
                        : "Stage files before committing"}
                    </Text>
                  </View>
                </View>
                <TextInput
                  value={commitMessage}
                  onChangeText={setCommitMessage}
                  placeholder="Commit message"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  style={{
                    minHeight: 44,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: palette.border,
                    backgroundColor: isDark ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.78)",
                    paddingHorizontal: 12,
                    color: palette.ink,
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      label={
                        gitAction === "commit" ? "Committing..." : gitAction === "push" ? "Pushing..." : "Commit & Push"
                      }
                      loading={committing}
                      disabled={!hasStagedChanges || !commitMessage.trim() || committing}
                      onPress={() => void commitAndPush()}
                    />
                  </View>
                  {github && onPublish ? (
                    <View style={{ flex: 1 }}>
                      <ActionButton label="Publish PR" variant="secondary" onPress={onPublish} />
                    </View>
                  ) : null}
                </View>
              </View>

              {branches.length > 0 ? (
                <View
                  style={{
                    borderRadius: 22,
                    borderWidth: 1,
                    borderColor: palette.border,
                    backgroundColor: isDark ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.62)",
                    padding: 12,
                    gap: 10,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "800",
                      letterSpacing: 1.5,
                      color: palette.muted,
                      textTransform: "uppercase",
                    }}
                  >
                    Branches
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {branches.slice(0, 8).map((branch) => (
                      <BranchPill
                        key={`${branch.name}:${branch.isCurrent ? "current" : "branch"}`}
                        branch={branch}
                        onPress={branch.isCurrent ? undefined : () => void checkoutBranch(branch)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {loading ? (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <ActivityIndicator color={palette.accent} />
                  <Text style={{ marginTop: 12, color: palette.soft }}>Loading git graph…</Text>
                </View>
              ) : commits.length === 0 ? (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <History size={32} color={palette.muted} />
                  <Text style={{ marginTop: 12, color: palette.soft }}>No commits yet</Text>
                </View>
              ) : (
                commits.map((commit, index) => {
                  const itemAnim = getCommitItemAnim(commit.sha)
                  return (
                    <Animated.View
                      key={commit.sha}
                      style={{
                        transform: [
                          {
                            scale: itemAnim ? itemAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) : 1,
                          },
                        ],
                        opacity: itemAnim ? itemAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) : 1,
                      }}
                    >
                      <Pressable
                        onPressIn={() => {
                          const itemScale = new Animated.Value(1)
                          Animated.spring(itemScale, {
                            toValue: 0.98,
                            friction: 20,
                            tension: 170,
                            useNativeDriver: true,
                          }).start()
                        }}
                        onPressOut={() => {
                          const itemScale = new Animated.Value(1)
                          Animated.spring(itemScale, {
                            toValue: 1,
                            friction: 16,
                            tension: 150,
                            useNativeDriver: true,
                          }).start()
                        }}
                        style={({ pressed }) => ({
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                          opacity: pressed ? 0.8 : 1,
                          flexDirection: "row",
                          paddingHorizontal: 0,
                          paddingVertical: 14,
                          borderBottomWidth: 1,
                          borderBottomColor: palette.border,
                          backgroundColor: commit.isHead
                            ? isDark
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(20,20,19,0.05)"
                            : "transparent",
                        })}
                      >
                        <View style={{ width: 36, alignItems: "center" }}>
                          <Circle
                            size={10}
                            fill={commit.isHead ? palette.accent : "transparent"}
                            color={palette.accent}
                            strokeWidth={2}
                          />
                          {index < commits.length - 1 && (
                            <View style={{ flex: 1, width: 2, backgroundColor: palette.border, marginTop: 4 }} />
                          )}
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ fontSize: 14, fontWeight: "500", color: palette.ink }} numberOfLines={2}>
                            {commit.message}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                            <Text style={{ fontSize: 11, color: palette.muted }}>{commit.author}</Text>
                            <Text style={{ fontSize: 10, color: palette.muted }}>·</Text>
                            <Text style={{ fontSize: 11, color: palette.muted }}>{commit.sha.slice(0, 7)}</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                            <Text style={{ fontSize: 10, color: "#22c55e", fontWeight: "600" }}>
                              +{commit.additions}
                            </Text>
                            <Text style={{ fontSize: 10, color: "#ef4444", fontWeight: "600" }}>
                              -{commit.deletions}
                            </Text>
                            <Text style={{ fontSize: 10, color: palette.muted }}>{commit.filesCount} files</Text>
                          </View>
                        </View>
                      </Pressable>
                    </Animated.View>
                  )
                })
              )}
            </ScrollView>
          )}

          {/* Review Tab */}
          {tab === "review" && (
            <View style={{ flex: 1 }}>
              {diffFiles.length > 0 ? (
                <GitLineDiffEditor
                  diffs={diffFiles}
                  activeFileIndex={activeFileIndex}
                  onFileSelect={setActiveFileIndex}
                  showLineNumbers
                  maxHeight={600}
                />
              ) : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
                  <Layers size={48} color={palette.muted} />
                  <Text style={{ marginTop: 16, fontSize: 16, fontWeight: "600", color: palette.ink }}>
                    No changes to review
                  </Text>
                  <Text style={{ marginTop: 8, fontSize: 14, color: palette.soft, textAlign: "center" }}>
                    Make some changes in the session to see them here
                  </Text>
                </View>
              )}
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}
