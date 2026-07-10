import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  ArrowLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Image,
  Maximize2,
  Minimize2,
  Package,
  RefreshCw,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { EditorBreadcrumb } from "@/components/editor/EditorBreadcrumb"
import { FileSearchSheet } from "@/components/editor/FileSearchSheet"
import { ActionButton } from "@/components/ui/ActionButton"
import { triggerHaptic } from "@/lib/haptics"
import { useServer } from "@/lib/server-context"
import { useAppTheme } from "@/lib/theme"
import type { FileNode, GitState } from "@/lib/types"

type TreeNode = FileNode & {
  depth: number
  children?: TreeNode[]
  childrenLoaded?: boolean
}

function buildPath(directory: string, segments: string[]): string {
  const base = directory.replace(/\/$/, "")
  return segments.length === 0 ? base : `${base}/${segments.join("/")}`
}

function sortFileNodes(items: FileNode[]) {
  return [...items]
    .filter((node) => !node.ignored)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1
      return left.name.localeCompare(right.name)
    })
}

function relativeParent(path: string) {
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= 1) return "Workspace root"
  return parts.slice(Math.max(0, parts.length - 4), -1).join("/")
}

function FileFilterRow({
  path,
  isDark,
  palette,
  onOpen,
}: {
  path: string
  isDark: boolean
  palette: ReturnType<typeof useAppTheme>["palette"]
  onOpen: (path: string) => void
}) {
  const iconBackground = isDark ? "rgba(255,255,255,0.06)" : "rgba(20,20,19,0.07)"
  const pressedBackground = isDark ? "rgba(255,255,255,0.05)" : "rgba(20,20,19,0.05)"
  const borderColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => ({
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
      backgroundColor: pressed ? pressedBackground : "transparent",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderColor,
    }),
    [pressedBackground, borderColor],
  )
  return (
    <Pressable
      onPress={() => {
        void triggerHaptic("selection")
        onOpen(path)
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${path.split("/").pop() || path}`}
      accessibilityHint={relativeParent(path)}
      style={rowStyle}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: iconBackground,
        }}
      >
        <FileCode2 size={15} color={palette.accentLight} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: palette.ink, fontWeight: "700" }}>
          {path.split("/").pop()}
        </Text>
        <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 11, color: palette.muted }}>
          {relativeParent(path)}
        </Text>
      </View>
    </Pressable>
  )
}

function filePresentation(node: FileNode, palette: ReturnType<typeof useAppTheme>["palette"], isDark: boolean) {
  if (node.type === "directory") {
    return { Icon: Folder, color: isDark ? "#fbbf24" : "#d97706", label: "Directory" }
  }
  const ext = node.name.split(".").pop()?.toLowerCase() ?? ""
  const codeExts = new Set([
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "swift",
    "kt",
    "java",
    "go",
    "rs",
    "py",
    "rb",
    "php",
  ])
  const textExts = new Set(["md", "mdx", "txt", "log", "yml", "yaml", "toml", "ini", "env"])
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"])
  if (["json", "jsonc"].includes(ext)) return { Icon: FileJson, color: "#22c55e", label: "JSON" }
  if (["css", "scss", "sass", "less"].includes(ext)) return { Icon: Braces, color: "#141413", label: ext.toUpperCase() }
  if (["sql", "db", "sqlite"].includes(ext)) return { Icon: Database, color: "#a855f7", label: ext.toUpperCase() }
  if (["lock", "plist"].includes(ext) || node.name === "package.json")
    return { Icon: Package, color: "#d97706", label: "Package" }
  if (["config", "conf"].includes(ext) || node.name.includes("config")) {
    return { Icon: Settings, color: palette.muted, label: "Config" }
  }
  if (imageExts.has(ext)) return { Icon: Image, color: "#ec4899", label: ext.toUpperCase() }
  if (codeExts.has(ext)) return { Icon: FileCode2, color: palette.accentLight, label: ext.toUpperCase() }
  if (textExts.has(ext)) return { Icon: FileText, color: palette.soft, label: ext.toUpperCase() }
  return { Icon: File, color: palette.soft, label: ext ? ext.toUpperCase() : "File" }
}

function ChromeIconButton({
  icon: Icon,
  label,
  onPress,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onPress(): void
  disabled?: boolean
}) {
  const { palette, isDark } = useAppTheme()
  const borderColor = isDark ? "rgba(255,255,255,0.13)" : "rgba(218,216,209,0.82)"
  const backgroundColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.72)"
  const buttonStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => ({
      width: 44,
      height: 44,
      borderRadius: 12,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor,
      backgroundColor,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      opacity: disabled ? 0.42 : pressed ? 0.68 : 1,
      transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
    }),
    [borderColor, backgroundColor, disabled],
  )
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={buttonStyle}
    >
      <Icon size={16} color={palette.ink} strokeWidth={2.2} />
    </Pressable>
  )
}

function GitTreeMarker({ status, dot }: { status?: "added" | "modified" | "deleted"; dot?: boolean }) {
  const { isDark } = useAppTheme()
  const color =
    status === "added"
      ? isDark
        ? "#74c69d"
        : "#2f855a"
      : status === "deleted"
        ? isDark
          ? "#f87171"
          : "#dc2626"
        : isDark
          ? "#d6a85f"
          : "#b7791f"

  if (dot) {
    return <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: color, opacity: 0.78 }} />
  }

  if (!status) return <View style={{ width: 18 }} />

  return (
    <Text
      style={{
        width: 18,
        color,
        fontSize: 12,
        fontWeight: "800",
        textAlign: "right",
        fontVariant: ["tabular-nums"],
      }}
    >
      {status === "added" ? "A" : status === "deleted" ? "D" : "M"}
    </Text>
  )
}

function IndentGuides({ depth }: { depth: number }) {
  const { isDark } = useAppTheme()
  if (depth <= 0) return null
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: depth }).map((_, index) => (
        <View
          key={index}
          style={{
            position: "absolute",
            left: 31 + index * 16,
            top: 0,
            bottom: 0,
            width: StyleSheet.hairlineWidth,
            backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,19,0.13)",
          }}
        />
      ))}
    </View>
  )
}

function ExplorerStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: number
  tone?: "neutral" | "accent"
}) {
  const { palette, isDark } = useAppTheme()
  const active = tone === "accent"
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? (isDark ? "rgba(255,255,255,0.34)" : "rgba(20,20,19,0.22)") : palette.border,
        backgroundColor: active
          ? isDark
            ? "rgba(255,255,255,0.12)"
            : "rgba(20,20,19,0.08)"
          : isDark
            ? "rgba(255,255,255,0.045)"
            : "rgba(255,255,255,0.65)",
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text
        style={{
          color: active ? palette.accentLight : palette.ink,
          fontSize: 11,
          fontWeight: "800",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>{label}</Text>
    </View>
  )
}

export default function ExplorerScreen() {
  const { palette, isDark } = useAppTheme()
  const { top } = useSafeAreaInsets()
  const { sessionId, directory, fallbackDirectory } = useLocalSearchParams<{
    sessionId: string
    directory: string
    fallbackDirectory?: string
  }>()
  const { client } = useServer()

  const [nodes, setNodes] = useState<FileNode[]>([])
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, "added" | "modified" | "deleted">>(new Map())
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [childrenCache, setChildrenCache] = useState<Record<string, FileNode[]>>({})
  const [expandingPaths, setExpandingPaths] = useState<Set<string>>(new Set())
  const [expandErrors, setExpandErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandingAll, setExpandingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [breadcrumbSegments, setBreadcrumbSegments] = useState<string[]>([])
  const [currentDir, setCurrentDir] = useState(directory ?? "")
  const [searchVisible, setSearchVisible] = useState(false)
  const [fileQuery, setFileQuery] = useState("")
  const [fileResults, setFileResults] = useState<string[]>([])
  const [fileSearchLoading, setFileSearchLoading] = useState(false)
  const searchRequestRef = useRef(0)

  const rootLabel = useMemo(() => (directory ?? "").split("/").pop() ?? "root", [directory])

  useEffect(() => {
    setCurrentDir(directory ?? "")
    setBreadcrumbSegments([])
    setExpandedPaths(new Set())
    setChildrenCache({})
    setExpandingPaths(new Set())
    setExpandErrors({})
  }, [directory])

  const load = useCallback(
    async (dir: string, options?: { preserveContent?: boolean }) => {
      const preserveContent = options?.preserveContent ?? false
      if (!client) {
        setNodes([])
        setError("Server connection is not available.")
        setLoading(false)
        setRefreshing(false)
        return
      }
      try {
        if (preserveContent) setRefreshing(true)
        else setLoading(true)
        setError(null)
        const workspaceClient = client.withDirectory(directory || dir)
        let [files, gitState] = await Promise.all([
          workspaceClient.listDirectory(dir),
          workspaceClient.getGitStatus().catch(
            (): GitState => ({
              branch: "",
              staged: [],
              unstaged: [],
              untracked: [],
              commitsAhead: 0,
              commitsBehind: 0,
            }),
          ),
        ])
        if (files.length === 0 && fallbackDirectory && fallbackDirectory !== dir) {
          const fallbackFiles = await client.withDirectory(fallbackDirectory).listDirectory(fallbackDirectory)
          if (fallbackFiles.length > 0) {
            files = fallbackFiles
            setCurrentDir(fallbackDirectory)
            const rel = fallbackDirectory.replace((directory ?? "").replace(/\/$/, ""), "").replace(/^\//, "")
            setBreadcrumbSegments(rel ? rel.split("/") : [])
          }
        }
        const map = new Map<string, "added" | "modified" | "deleted">()
        for (const f of [...(gitState.staged ?? []), ...(gitState.unstaged ?? [])]) {
          map.set(f.path, f.status === "added" ? "added" : f.status === "deleted" ? "deleted" : "modified")
        }
        for (const p of gitState.untracked ?? []) {
          map.set(typeof p === "string" ? p : (p as { path: string }).path, "added")
        }
        setGitStatusMap(map)
        setNodes(sortFileNodes(files))
        if (preserveContent) void triggerHaptic("success")
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        void triggerHaptic("error")
      } finally {
        if (preserveContent) setRefreshing(false)
        else setLoading(false)
      }
    },
    [client, directory, fallbackDirectory],
  )

  useEffect(() => {
    void load(currentDir)
  }, [load, currentDir])

  async function expandDir(node: FileNode) {
    if (!client) return
    if (childrenCache[node.absolute]) {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.add(node.absolute)
        return next
      })
      return
    }
    try {
      setExpandingPaths((prev) => {
        const next = new Set(prev)
        next.add(node.absolute)
        return next
      })
      setExpandErrors((prev) => {
        const next = { ...prev }
        delete next[node.absolute]
        return next
      })
      const children = await client.withDirectory(directory || currentDir).listDirectory(node.absolute)
      setChildrenCache((prev) => ({ ...prev, [node.absolute]: sortFileNodes(children) }))
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.add(node.absolute)
        return next
      })
    } catch (e) {
      setExpandErrors((prev) => ({ ...prev, [node.absolute]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setExpandingPaths((prev) => {
        const next = new Set(prev)
        next.delete(node.absolute)
        return next
      })
    }
  }

  function collapseDir(node: FileNode) {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      next.delete(node.absolute)
      return next
    })
  }

  function navigateInto(node: FileNode) {
    const newDir = node.absolute
    const rel = newDir.replace((directory ?? "").replace(/\/$/, ""), "").replace(/^\//, "")
    setBreadcrumbSegments(rel ? rel.split("/") : [])
    setCurrentDir(newDir)
    setExpandedPaths(new Set())
    setChildrenCache({})
    setExpandingPaths(new Set())
    setExpandErrors({})
  }

  function navigateToSegment(index: number) {
    if (index === 0) {
      setCurrentDir(directory ?? "")
      setBreadcrumbSegments([])
      setExpandedPaths(new Set())
      setChildrenCache({})
      setExpandingPaths(new Set())
      setExpandErrors({})
      return
    }
    const segments = breadcrumbSegments.slice(0, index)
    const newDir = buildPath(directory ?? "", segments)
    setBreadcrumbSegments(segments)
    setCurrentDir(newDir)
    setExpandedPaths(new Set())
    setChildrenCache({})
    setExpandingPaths(new Set())
    setExpandErrors({})
  }

  function openFile(node: FileNode) {
    openPath(node.path, node.absolute)
  }

  function openPath(filePath: string, absolutePath?: string, line?: number) {
    const resolvedAbsolute =
      absolutePath ??
      (filePath.startsWith("/") ? filePath : directory ? `${directory.replace(/\/$/, "")}/${filePath}` : filePath)
    router.push({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pathname: "/sessions/editor" as any,
      params: {
        sessionId,
        filePath,
        absolute: resolvedAbsolute,
        directory: directory ?? "",
        ...(line ? { highlightLine: String(line) } : {}),
      },
    })
  }

  // Flatten tree for FlatList rendering
  function flattenNodes(fileNodes: FileNode[], depth = 0): TreeNode[] {
    const result: TreeNode[] = []
    for (const n of fileNodes) {
      const treeNode: TreeNode = { ...n, depth }
      result.push(treeNode)
      if (n.type === "directory" && expandedPaths.has(n.absolute)) {
        const children = childrenCache[n.absolute] ?? []
        result.push(...flattenNodes(children, depth + 1))
      }
    }
    return result
  }

  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes, expandedPaths, childrenCache])
  const directoryCount = useMemo(() => flatNodes.filter((node) => node.type === "directory").length, [flatNodes])
  const fileCount = useMemo(() => flatNodes.filter((node) => node.type === "file").length, [flatNodes])
  const changedCount = useMemo(
    () => flatNodes.filter((node) => gitStatusMap.has(node.path) || gitStatusMap.has(node.absolute)).length,
    [flatNodes, gitStatusMap],
  )

  async function expandVisibleDirectories() {
    if (expandingAll) return
    const dirs = flatNodes.filter((node) => node.type === "directory" && !expandedPaths.has(node.absolute)).slice(0, 40)
    if (!dirs.length) return
    try {
      setExpandingAll(true)
      for (let index = 0; index < dirs.length; index += 6) {
        await Promise.all(dirs.slice(index, index + 6).map((node) => expandDir(node)))
      }
      void triggerHaptic("success")
    } finally {
      setExpandingAll(false)
    }
  }

  function collapseAll() {
    setExpandedPaths(new Set())
    setExpandErrors({})
  }

  // File search by name
  useEffect(() => {
    if (!fileQuery.trim() || !client) {
      searchRequestRef.current += 1
      setFileResults([])
      setFileSearchLoading(false)
      return
    }
    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    const t = setTimeout(async () => {
      try {
        if (searchRequestRef.current !== requestId) return
        setFileSearchLoading(true)
        const results = await client.withDirectory(directory || currentDir).searchFiles(fileQuery.trim())
        if (searchRequestRef.current !== requestId) return
        setFileResults(results.slice(0, 30))
      } catch {
        if (searchRequestRef.current !== requestId) return
        setFileResults([])
      } finally {
        if (searchRequestRef.current !== requestId) return
        setFileSearchLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [client, currentDir, directory, fileQuery])

  const renderNode = ({ item }: { item: TreeNode }) => {
    const isDir = item.type === "directory"
    const isExpanded = expandedPaths.has(item.absolute)
    const isExpanding = expandingPaths.has(item.absolute)
    const expandError = expandErrors[item.absolute]
    const gitStatus = gitStatusMap.get(item.path) ?? gitStatusMap.get(item.absolute)
    const hasChangedChild =
      isDir &&
      Array.from(gitStatusMap.keys()).some(
        (key) => key.startsWith(`${item.path}/`) || key.startsWith(`${item.absolute}/`),
      )
    const presentation = filePresentation(item, palette, isDark)
    const Icon = isDir && isExpanded ? FolderOpen : presentation.Icon

    return (
      <View style={{ position: "relative" }}>
        <IndentGuides depth={item.depth} />
        <Pressable
          onPress={() => {
            void triggerHaptic("selection")
            if (isDir) {
              isExpanded ? collapseDir(item) : void expandDir(item)
            } else {
              openFile(item)
            }
          }}
          onLongPress={() => {
            if (!isDir) return
            void triggerHaptic("selection")
            navigateInto(item)
          }}
          accessibilityRole="button"
          accessibilityLabel={`${isDir ? "Folder" : "File"} ${item.name}`}
          accessibilityHint={isDir ? "Double tap to expand. Use the trailing button to open this folder." : "Opens in the editor."}
          accessibilityState={isDir ? { expanded: isExpanded, busy: isExpanding } : undefined}
          style={({ pressed }) => ({
            marginHorizontal: 10,
            marginVertical: 3,
            marginLeft: 10 + item.depth * 16,
            borderRadius: 8,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,19,0.08)",
            backgroundColor: pressed
              ? isDark
                ? "rgba(255,255,255,0.09)"
                : "rgba(20,20,19,0.08)"
              : isDark
                ? "rgba(255,255,255,0.035)"
                : "rgba(255,255,255,0.72)",
            overflow: "hidden",
          })}
        >
          <View
            style={{
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingLeft: 9,
              paddingRight: 10,
              paddingVertical: 7,
            }}
          >
            <View style={{ width: 17, alignItems: "center" }}>
              {isExpanding ? (
                <ActivityIndicator size="small" color={palette.accent} />
              ) : isDir ? (
                isExpanded ? (
                  <ChevronDown size={14} color={palette.muted} strokeWidth={2.4} />
                ) : (
                  <ChevronRight size={14} color={palette.muted} strokeWidth={2.4} />
                )
              ) : (
                <View style={{ width: 14 }} />
              )}
            </View>

            <Icon
              size={16}
              color={isDir && isExpanded ? (isDark ? "#fde68a" : "#b45309") : presentation.color}
              strokeWidth={2}
            />

            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13.5,
                fontWeight: isDir ? "800" : "600",
                color: isDir ? (isDark ? "#f8d48a" : "#b7791f") : palette.ink,
              }}
            >
              {item.name}
            </Text>

            <GitTreeMarker status={gitStatus} dot={!gitStatus && hasChangedChild} />

            {isDir ? (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation()
                  void triggerHaptic("selection")
                  navigateInto(item)
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open folder ${item.name}`}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed
                    ? isDark
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(20,20,19,0.08)"
                    : "transparent",
                })}
              >
                <FolderOpen size={14} color={palette.muted} strokeWidth={2.1} />
              </Pressable>
            ) : null}
          </View>

          {expandError ? (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              <Text numberOfLines={1} style={{ color: palette.danger, fontSize: 11 }}>
                {expandError} · tap to retry
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    )
  }

  const showFileSearch = fileQuery.trim().length > 0

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: top + 8,
          paddingBottom: 10,
          paddingHorizontal: 14,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: palette.border,
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
          <ChromeIconButton icon={ArrowLeft} label="Go back" onPress={() => router.back()} />

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: palette.ink, fontSize: 17, fontWeight: "800" }}>Repository tree</Text>
            <EditorBreadcrumb rootLabel={rootLabel} segments={breadcrumbSegments} onSegmentPress={navigateToSegment} />
          </View>

          <ChromeIconButton icon={Search} label="Search file contents" onPress={() => setSearchVisible(true)} />
          <ChromeIconButton
            icon={RefreshCw}
            label="Refresh tree"
            onPress={() => void load(currentDir, { preserveContent: true })}
            disabled={loading || refreshing}
          />
        </View>

        {/* File name search bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 10,
            gap: 8,
            borderRadius: 12,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(218,216,209,0.7)",
            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)",
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Search size={13} color={palette.muted} strokeWidth={2} />
          <TextInput
            value={fileQuery}
            onChangeText={setFileQuery}
            placeholder="Filter filenames…"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, fontSize: 13, color: palette.ink }}
          />
          {fileSearchLoading ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : fileQuery ? (
            <Pressable
              onPress={() => setFileQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear filename filter"
              hitSlop={8}
            >
              <X size={13} color={palette.muted} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <ExplorerStat label="Files" value={fileCount} />
          <ExplorerStat label="Dirs" value={directoryCount} />
          <ExplorerStat label="Open" value={expandedPaths.size} />
          <ExplorerStat label="Changed" value={changedCount} tone={changedCount > 0 ? "accent" : "neutral"} />
          <View style={{ flex: 1 }} />
          <ChromeIconButton
            icon={Maximize2}
            label="Expand visible directories"
            onPress={() => void expandVisibleDirectories()}
            disabled={expandingAll}
          />
          <ChromeIconButton
            icon={Minimize2}
            label="Collapse all directories"
            onPress={collapseAll}
            disabled={!expandedPaths.size}
          />
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
          <Text selectable style={{ color: palette.danger, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
            {error}
          </Text>
          <ActionButton
            label="Retry"
            variant="secondary"
            onPress={() => void load(currentDir, { preserveContent: true })}
          />
        </View>
      ) : showFileSearch ? (
        <FlatList
          data={fileResults}
          keyExtractor={(item, i) => `${item}:${i}`}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(currentDir, { preserveContent: true })}
              tintColor={palette.muted}
            />
          }
          ListEmptyComponent={
            !fileSearchLoading ? (
              <View style={{ alignItems: "center", padding: 32, gap: 8 }}>
                <FolderSearch size={24} color={palette.muted} strokeWidth={1.8} />
                <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "700" }}>No files found</Text>
                <Text style={{ color: palette.muted, fontSize: 12, textAlign: "center", lineHeight: 18 }}>
                  Try a shorter filename fragment or clear the filter to return to the full tree.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => <FileFilterRow path={item} isDark={isDark} palette={palette} onOpen={openPath} />}
        />
      ) : (
        <FlatList
          data={flatNodes}
          keyExtractor={(item, i) => `${item.absolute}:${i}`}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(currentDir, { preserveContent: true })}
              tintColor={palette.muted}
            />
          }
          renderItem={renderNode}
          ListEmptyComponent={
            <View style={{ alignItems: "center", padding: 32, gap: 8 }}>
              <FolderSearch size={24} color={palette.muted} strokeWidth={1.8} />
              <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "700" }}>Empty directory</Text>
              <Text style={{ color: palette.muted, fontSize: 12 }}>No visible files in this workspace path.</Text>
            </View>
          }
        />
      )}

      {/* Ripgrep search modal */}
      <FileSearchSheet
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelect={(file, line) => openPath(file, undefined, line)}
      />
    </View>
  )
}
