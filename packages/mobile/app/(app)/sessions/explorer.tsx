import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ArrowLeft, ChevronDown, ChevronRight, File, Folder, FolderOpen, Search, X } from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { EditorBreadcrumb } from "@/components/editor/EditorBreadcrumb"
import { FileSearchSheet } from "@/components/editor/FileSearchSheet"
import { GitFileStatusBadge } from "@/components/git/GitFileStatusBadge"
import { useServer } from "@/lib/server-provider"
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

export default function ExplorerScreen() {
  const { palette, isDark } = useAppTheme()
  const { top } = useSafeAreaInsets()
  const { sessionId, directory } = useLocalSearchParams<{ sessionId: string; directory: string }>()
  const { client } = useServer()

  const [nodes, setNodes] = useState<FileNode[]>([])
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, "added" | "modified" | "deleted">>(new Map())
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [childrenCache, setChildrenCache] = useState<Record<string, FileNode[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [breadcrumbSegments, setBreadcrumbSegments] = useState<string[]>([])
  const [currentDir, setCurrentDir] = useState(directory ?? "")
  const [searchVisible, setSearchVisible] = useState(false)
  const [fileQuery, setFileQuery] = useState("")
  const [fileResults, setFileResults] = useState<string[]>([])
  const [fileSearchLoading, setFileSearchLoading] = useState(false)

  const rootLabel = useMemo(() => (directory ?? "").split("/").pop() ?? "root", [directory])

  const load = useCallback(
    async (dir: string) => {
      if (!client) return
      try {
        setLoading(true)
        setError(null)
        const [files, gitState] = await Promise.all([
          client.listDirectory(dir),
          client.getGitStatus().catch((): GitState => ({ branch: "", staged: [], unstaged: [], untracked: [], commitsAhead: 0, commitsBehind: 0 })),
        ])
        const map = new Map<string, "added" | "modified" | "deleted">()
        for (const f of [...(gitState.staged ?? []), ...(gitState.unstaged ?? [])]) {
          map.set(f.path, f.status === "added" ? "added" : f.status === "deleted" ? "deleted" : "modified")
        }
        for (const p of gitState.untracked ?? []) {
          map.set(typeof p === "string" ? p : (p as { path: string }).path, "added")
        }
        setGitStatusMap(map)
        setNodes(files.filter((n) => !n.ignored))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [client],
  )

  useEffect(() => {
    void load(currentDir)
  }, [load, currentDir])

  async function expandDir(node: FileNode) {
    if (childrenCache[node.absolute]) {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.add(node.absolute)
        return next
      })
      return
    }
    try {
      const children = await client!.listDirectory(node.absolute)
      setChildrenCache((prev) => ({ ...prev, [node.absolute]: children.filter((n) => !n.ignored) }))
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.add(node.absolute)
        return next
      })
    } catch {
      // ignore expand errors
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
  }

  function navigateToSegment(index: number) {
    if (index === 0) {
      setCurrentDir(directory ?? "")
      setBreadcrumbSegments([])
      setExpandedPaths(new Set())
      setChildrenCache({})
      return
    }
    const segments = breadcrumbSegments.slice(0, index)
    const newDir = buildPath(directory ?? "", segments)
    setBreadcrumbSegments(segments)
    setCurrentDir(newDir)
    setExpandedPaths(new Set())
    setChildrenCache({})
  }

  function openFile(node: FileNode) {
    router.push({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pathname: "/sessions/editor" as any,
      params: { sessionId, filePath: node.path, absolute: node.absolute, directory: directory ?? "" },
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

  // File search by name
  useEffect(() => {
    if (!fileQuery.trim() || !client) {
      setFileResults([])
      return
    }
    const t = setTimeout(async () => {
      try {
        setFileSearchLoading(true)
        const results = await client.searchFiles(fileQuery.trim())
        setFileResults(results.slice(0, 30))
      } catch {
        setFileResults([])
      } finally {
        setFileSearchLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [fileQuery, client])

  const renderNode = ({ item }: { item: TreeNode }) => {
    const isDir = item.type === "directory"
    const isExpanded = expandedPaths.has(item.absolute)
    const gitStatus = gitStatusMap.get(item.path) ?? gitStatusMap.get(item.absolute)

    return (
      <Pressable
        onPress={() => {
          if (isDir) {
            isExpanded ? collapseDir(item) : void expandDir(item)
          } else {
            openFile(item)
          }
        }}
        onLongPress={() => isDir && navigateInto(item)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 8,
          paddingLeft: 16 + item.depth * 18,
          paddingRight: 12,
          gap: 8,
          backgroundColor: pressed
            ? isDark
              ? "rgba(255,255,255,0.05)"
              : "rgba(14,165,233,0.05)"
            : "transparent",
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
        })}
      >
        {/* Expand/collapse chevron for directories */}
        {isDir ? (
          isExpanded ? (
            <ChevronDown size={13} color={palette.muted} strokeWidth={2} />
          ) : (
            <ChevronRight size={13} color={palette.muted} strokeWidth={2} />
          )
        ) : (
          <View style={{ width: 13 }} />
        )}

        {/* File/folder icon */}
        {isDir ? (
          isExpanded ? (
            <FolderOpen size={15} color={isDark ? "#fbbf24" : "#d97706"} strokeWidth={1.8} />
          ) : (
            <Folder size={15} color={isDark ? "#fbbf24" : "#d97706"} strokeWidth={1.8} />
          )
        ) : (
          <File size={15} color={palette.soft} strokeWidth={1.8} />
        )}

        {/* Name */}
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 13.5,
            fontWeight: isDir ? "500" : "400",
            color: isDir ? palette.ink : palette.soft,
          }}
        >
          {item.name}
        </Text>

        {/* Git status badge */}
        {gitStatus && (
          <GitFileStatusBadge status={gitStatus} compact />
        )}
      </Pressable>
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
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.82)",
              overflow: "hidden",
              padding: 10,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={44}
              style={StyleSheet.absoluteFill}
              fallbackColor={isDark ? "rgba(22,22,22,0.88)" : "rgba(255,255,255,0.88)"}
              pointerEvents="none"
            />
            <ArrowLeft size={16} color={palette.ink} strokeWidth={2.2} />
          </Pressable>

          <View style={{ flex: 1, minWidth: 0 }}>
            <EditorBreadcrumb
              rootLabel={rootLabel}
              segments={breadcrumbSegments}
              onSegmentPress={navigateToSegment}
            />
          </View>

          {/* Text search (ripgrep) */}
          <Pressable
            onPress={() => setSearchVisible(true)}
            hitSlop={8}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.82)",
              overflow: "hidden",
              padding: 10,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={44}
              style={StyleSheet.absoluteFill}
              fallbackColor={isDark ? "rgba(22,22,22,0.88)" : "rgba(255,255,255,0.88)"}
              pointerEvents="none"
            />
            <Search size={16} color={palette.ink} strokeWidth={2.2} />
          </Pressable>
        </View>

        {/* File name search bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 10,
            gap: 8,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.7)",
            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)",
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Search size={13} color={palette.muted} strokeWidth={2} />
          <TextInput
            value={fileQuery}
            onChangeText={setFileQuery}
            placeholder="Filter files…"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, fontSize: 13, color: palette.ink }}
          />
          {fileSearchLoading ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : fileQuery ? (
            <Pressable onPress={() => setFileQuery("")} hitSlop={6}>
              <X size={13} color={palette.muted} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: palette.danger, fontSize: 14, textAlign: "center" }}>{error}</Text>
        </View>
      ) : showFileSearch ? (
        <FlatList
          data={fileResults}
          keyExtractor={(item, i) => `${item}:${i}`}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListEmptyComponent={
            !fileSearchLoading ? (
              <View style={{ alignItems: "center", padding: 32 }}>
                <Text style={{ color: palette.muted, fontSize: 14 }}>No files found</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pathname: "/sessions/editor" as any,
                  params: { sessionId, filePath: item, absolute: item, directory: directory ?? "" },
                })
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 10,
                gap: 8,
                backgroundColor: pressed
                  ? isDark
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(14,165,233,0.05)"
                  : "transparent",
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
              })}
            >
              <File size={14} color={palette.soft} strokeWidth={1.8} />
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontSize: 13, color: palette.ink }}
              >
                {item.split("/").pop()}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 11, color: palette.muted, maxWidth: 160 }}>
                {item.split("/").slice(-3, -1).join("/")}
              </Text>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={flatNodes}
          keyExtractor={(item, i) => `${item.absolute}:${i}`}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={renderNode}
          ListEmptyComponent={
            <View style={{ alignItems: "center", padding: 32 }}>
              <Text style={{ color: palette.muted, fontSize: 14 }}>Empty directory</Text>
            </View>
          }
        />
      )}

      {/* Ripgrep search modal */}
      <FileSearchSheet
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelect={(file, line) =>
          router.push({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pathname: "/sessions/editor" as any,
            params: { sessionId, filePath: file, absolute: file, directory: directory ?? "", highlightLine: line },
          })
        }
      />
    </View>
  )
}
