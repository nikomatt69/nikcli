import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileCheck,
  FileX,
  GitBranch,
  GitCommit,
  History,
  Layers,
  MoreVertical,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AdaptiveBlur } from "@/components/GlassView"
import { ActionButton } from "@/components/ui/ActionButton"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { GitFileTree } from "./GitFileTree"
import { GitLineDiffEditor } from "./GitLineDiffEditor"
import { GitFileStatusBadge } from "./GitFileStatusBadge"
import type { GitCommit as CommitInfo, GitFileStatus, GitState, ParsedFileDiff } from "@/lib/types"

type TabType = "changes" | "commits" | "review"

interface GitReviewModalProps {
  visible: boolean
  onClose: () => void
  sessionID: string
  github?: {
    owner: string
    repo: string
    baseBranch: string
    headBranch: string
    pullRequest?: { number: number; url: string; title: string }
  }
  onCommit: (message: string, files: string[]) => Promise<void>
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

export function GitReviewModal({ visible, onClose, sessionID, github, onCommit, onPublish }: GitReviewModalProps) {
  const { palette, isDark } = useAppTheme()
  const { top, bottom } = useSafeAreaInsets()
  const [tab, setTab] = useState<TabType>("changes")
  const [loading, setLoading] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [gitState, setGitState] = useState<GitState | null>(null)
  const [commits, setCommits] = useState<CommitItem[]>([])
  const [diffFiles, setDiffFiles] = useState<ParsedFileDiff[]>([])
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  const headerHeight = top + 52
  const entranceAnim = useRef(new Animated.Value(0)).current
  const tabIndicatorAnim = useRef(new Animated.Value(0)).current
  const contentFadeAnim = useRef(new Animated.Value(1)).current
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
    Animated.sequence([
      Animated.timing(contentFadeAnim, {
        toValue: 0,
        duration: 120,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(contentFadeAnim, {
        toValue: 1,
        duration: 180,
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

  const createPressAnim = () => {
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

  const closeButtonAnim = createPressAnim()
  const refreshButtonAnim = createPressAnim()
  const stageAllAnim = createPressAnim()

  const fetchGitData = useCallback(async () => {
    setLoading(true)
    try {
      const { getMobileClient } = await import("@/lib/client")
      const client = await getMobileClient()
      if (!client) return

      const [state, commitsData, diffsData] = await Promise.all([
        client.getGitStatus().catch(() => null),
        client.getGitCommits(20).catch(() => []),
        client.getGitDiff().catch(() => []),
      ])

      setGitState(state)
      setCommits(
        commitsData.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author.name,
          timestamp: c.author.timestamp,
          additions: c.additions,
          deletions: c.deletions,
          filesCount: c.filesCount,
          isHead: false,
        })),
      )
      setDiffFiles(diffsData)
    } catch (error) {
      console.error("Failed to fetch git data:", error)
    } finally {
      setLoading(false)
    }
  }, [])

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
    const allPaths = [
      ...gitState.staged.map((f) => f.path),
      ...gitState.unstaged.map((f) => f.path),
      ...gitState.untracked,
    ]
    const client = await import("@/lib/client").then((m) => m.getMobileClient())
    if (!client) return
    try {
      await client.stageGitFiles(allPaths)
      void triggerHaptic("selection")
      void handleRefresh()
    } catch (error) {
      console.error("Failed to stage files:", error)
    }
  }

  const totalChanges =
    (gitState?.staged.length ?? 0) + (gitState?.unstaged.length ?? 0) + (gitState?.untracked.length ?? 0)
  const hasStagedChanges = (gitState?.staged.length ?? 0) > 0

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Animated.View style={[{ flex: 1, backgroundColor: palette.background }, headerAnimStyle]}>
        {/* Header */}
        <View
          style={{
            paddingTop: top + 8,
            paddingBottom: 0,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
            backgroundColor: isDark ? palette.surface : palette.background,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 }}>
            <Animated.View style={{ transform: [{ scale: closeButtonAnim.scaleAnim }] }}>
              <Pressable
                onPress={onClose}
                onPressIn={closeButtonAnim.onPressIn}
                onPressOut={closeButtonAnim.onPressOut}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ArrowLeft size={18} color={palette.ink} />
              </Pressable>
            </Animated.View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: "600", color: palette.ink }}>Review Changes</Text>
              <Text style={{ fontSize: 12, color: palette.soft }}>
                {github ? `${github.owner}/${github.repo}` : "Local repository"}
              </Text>
            </View>
            <Animated.View style={{ transform: [{ scale: refreshButtonAnim.scaleAnim }] }}>
              <Pressable
                onPress={handleRefresh}
                onPressIn={refreshButtonAnim.onPressIn}
                onPressOut={refreshButtonAnim.onPressOut}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RefreshCw size={16} color={palette.ink} />
              </Pressable>
            </Animated.View>
          </View>

          {/* Branch info */}
          {github && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 12,
                  backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                }}
              >
                <GitBranch size={14} color={palette.accentLight} />
                <Text style={{ flex: 1, fontSize: 12, fontWeight: "500", color: palette.ink }} numberOfLines={1}>
                  {github.baseBranch} → {github.headBranch}
                </Text>
              </View>
            </View>
          )}

          {/* Tabs */}
          <View style={{ flexDirection: "row", paddingHorizontal: 16, gap: 8 }}>
            {(["changes", "commits", "review"] as TabType[]).map((t) => {
              const tabAnim = useRef(new Animated.Value(1)).current
              return (
                <Animated.View key={t} style={{ flex: 1, transform: [{ scale: tabAnim }] }}>
                  <Pressable
                    onPress={() => handleTabChange(t)}
                    onPressIn={() => {
                      Animated.spring(tabAnim, {
                        toValue: 0.96,
                        friction: 20,
                        tension: 170,
                        useNativeDriver: true,
                      }).start()
                    }}
                    onPressOut={() => {
                      Animated.spring(tabAnim, {
                        toValue: 1,
                        friction: 16,
                        tension: 150,
                        useNativeDriver: true,
                      }).start()
                    }}
                    style={{
                      paddingVertical: 10,
                      borderRadius: 12,
                      backgroundColor: tab === t ? palette.accent : "transparent",
                      borderWidth: 1,
                      borderColor: tab === t ? palette.accent : palette.border,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: tab === t ? "#fff" : palette.soft }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </Pressable>
                </Animated.View>
              )
            })}
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
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: palette.border,
                }}
              >
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e" }} />
                    <Text style={{ fontSize: 11, color: "#22c55e", fontWeight: "600" }}>
                      {gitState?.staged.length ?? 0}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b" }} />
                    <Text style={{ fontSize: 11, color: "#f59e0b", fontWeight: "600" }}>
                      {gitState?.unstaged.length ?? 0}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#6b7280" }} />
                    <Text style={{ fontSize: 11, color: "#6b7280", fontWeight: "600" }}>
                      {gitState?.untracked.length ?? 0}
                    </Text>
                  </View>
                </View>
                <Animated.View style={{ transform: [{ scale: stageAllAnim.scaleAnim }] }}>
                  <Pressable
                    onPress={handleStageAll}
                    onPressIn={stageAllAnim.onPressIn}
                    onPressOut={stageAllAnim.onPressOut}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: isDark ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.10)",
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.2)",
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "600", color: "#22c55e" }}>Stage All</Text>
                  </Pressable>
                </Animated.View>
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
                      label="Commit & Push"
                      variant={hasStagedChanges ? "primary" : "secondary"}
                      disabled={!hasStagedChanges}
                    />
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Commits Tab */}
          {tab === "commits" && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: bottom + 20 }}>
              {loading ? (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <Text style={{ color: palette.soft }}>Loading commits...</Text>
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
                          paddingHorizontal: 16,
                          paddingVertical: 14,
                          borderBottomWidth: 1,
                          borderBottomColor: palette.border,
                          backgroundColor: commit.isHead
                            ? isDark
                              ? "rgba(14,165,233,0.08)"
                              : "rgba(14,165,233,0.05)"
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
