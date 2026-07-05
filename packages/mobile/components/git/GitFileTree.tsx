import { useCallback, useMemo, useState } from "react"
import { LayoutAnimation, Pressable, ScrollView, Text, View } from "react-native"
import { ChevronRight, Folder, FolderOpen } from "lucide-react-native"
import type { GitFileStatus, ParsedFileDiff } from "@/lib/types"
import { GitFileStatusBadge } from "./GitFileStatusBadge"
import { useAppTheme } from "@/lib/theme"

interface FileTreeItem {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeItem[]
  status?: GitFileStatus["status"]
  additions?: number
  deletions?: number
}

interface GitFileTreeProps {
  files: GitFileStatus[]
  selectedFiles?: Set<string>
  onFileSelect?: (path: string, selected: boolean) => void
  onFilePress?: (path: string) => void
  selectable?: boolean
}

function buildTree(files: GitFileStatus[]): FileTreeItem[] {
  const root: FileTreeItem[] = []
  const pathMap = new Map<string, FileTreeItem>()
  const filesByPath = new Map<string, GitFileStatus>()
  for (const file of files) {
    filesByPath.set(file.path, file)
  }

  const allPaths = new Set<string>()
  for (const file of files) {
    allPaths.add(file.path)
    if (file.status === "renamed" && file.oldPath) {
      allPaths.add(file.oldPath)
    }
  }

  for (const path of allPaths) {
    const parts = path.split("/")
    let current = root
    let currentPath = ""

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (isLast) {
        const fileStatus = filesByPath.get(path)
        if (!pathMap.has(currentPath)) {
          const item: FileTreeItem = {
            name: part,
            path: currentPath,
            isDirectory: false,
            status: fileStatus?.status,
            additions: fileStatus?.status === "modified" || fileStatus?.status === "added" ? fileStatus.additions : 0,
            deletions: fileStatus?.status === "modified" || fileStatus?.status === "added" ? fileStatus.deletions : 0,
          }
          current.push(item)
          pathMap.set(currentPath, item)
        }
      } else {
        if (!pathMap.has(currentPath)) {
          const dir: FileTreeItem = {
            name: part,
            path: currentPath,
            isDirectory: true,
            children: [],
          }
          current.push(dir)
          pathMap.set(currentPath, dir)
          current = dir.children!
        } else {
          const existing = pathMap.get(currentPath)!
          if (existing.isDirectory && existing.children) {
            current = existing.children
          }
        }
      }
    }
  }

  function sortTree(items: FileTreeItem[]): FileTreeItem[] {
    return items
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map((item) => {
        if (item.children) {
          item.children = sortTree(item.children)
        }
        return item
      })
  }

  return sortTree(root)
}

function TreeItem({
  item,
  depth,
  selectedFiles,
  onFileSelect,
  onFilePress,
  selectable,
  expandedPaths,
  onToggle,
}: {
  item: FileTreeItem
  depth: number
  selectedFiles?: Set<string>
  onFileSelect?: (path: string, selected: boolean) => void
  onFilePress?: (path: string) => void
  selectable?: boolean
  expandedPaths: Set<string>
  onToggle: (path: string) => void
}) {
  const { palette, isDark } = useAppTheme()
  const isExpanded = expandedPaths.has(item.path)
  const isSelected = selectedFiles?.has(item.path)
  const hasChildren = item.children && item.children.length > 0

  const toggleExpand = useCallback(() => {
    if (hasChildren) {
      LayoutAnimation.configureNext({
        duration: 200,
        create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
        update: { type: LayoutAnimation.Types.spring, springDamping: 0.8 },
        delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity },
      })
      onToggle(item.path)
    }
  }, [hasChildren, item.path, onToggle])

  const handlePress = useCallback(() => {
    if (item.isDirectory) {
      toggleExpand()
    } else if (onFilePress) {
      onFilePress(item.path)
    }
  }, [item.isDirectory, onFilePress, toggleExpand])

  const handleSelect = useCallback(() => {
    if (onFileSelect) {
      onFileSelect(item.path, !isSelected)
    }
  }, [item.path, isSelected, onFileSelect])

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: depth * 16 + 12,
          paddingRight: 12,
          paddingVertical: 8,
          backgroundColor: isSelected ? (isDark ? "rgba(255,255,255,0.15)" : "rgba(20,20,19,0.08)") : "transparent",
          borderRadius: 10,
          marginHorizontal: 8,
          marginVertical: 1,
        }}
      >
        {hasChildren && (
          <Pressable onPress={toggleExpand} hitSlop={8} style={{ marginRight: 4 }}>
            <ChevronRight
              size={14}
              color={palette.muted}
              strokeWidth={2}
              style={{
                transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
              }}
            />
          </Pressable>
        )}
        {!hasChildren && <View style={{ width: 18 }} />}
        {item.isDirectory ? (
          <View style={{ marginRight: 8 }}>
            {isExpanded ? (
              <FolderOpen size={16} color={palette.accentLight} strokeWidth={2} />
            ) : (
              <Folder size={16} color={palette.accentLight} strokeWidth={2} />
            )}
          </View>
        ) : item.status ? (
          <GitFileStatusBadge status={item.status} additions={item.additions} deletions={item.deletions} compact />
        ) : (
          <View style={{ width: 18 }} />
        )}
        <Text
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: item.isDirectory ? "600" : "400",
            color: isSelected ? palette.accentLight : palette.ink,
          }}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        {selectable && !item.isDirectory && (
          <Pressable
            onPress={handleSelect}
            hitSlop={8}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              borderWidth: 1.5,
              borderColor: isSelected ? palette.accent : palette.border,
              backgroundColor: isSelected ? palette.accent : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isSelected && <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text>}
          </Pressable>
        )}
      </Pressable>
      {hasChildren && isExpanded && item.children && (
        <View>
          {item.children.map((child) => (
            <TreeItem
              key={child.path}
              item={child}
              depth={depth + 1}
              selectedFiles={selectedFiles}
              onFileSelect={onFileSelect}
              onFilePress={onFilePress}
              selectable={selectable}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
            />
          ))}
        </View>
      )}
    </>
  )
}

export function GitFileTree({ files, selectedFiles, onFileSelect, onFilePress, selectable = false }: GitFileTreeProps) {
  const { palette } = useAppTheme()
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildTree(files), [files])

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const stagedCount = files.filter((f) => f.status !== "untracked").length
  const untrackedCount = files.filter((f) => f.status === "untracked").length

  return (
    <View className="flex-1">
      {(stagedCount > 0 || untrackedCount > 0) && (
        <View
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: palette.muted,
            }}
          >
            {stagedCount} changed · {untrackedCount} untracked
          </Text>
        </View>
      )}
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {tree.length === 0 ? (
          <View style={{ padding: 24, alignItems: "center" }}>
            <Text style={{ fontSize: 14, color: palette.soft }}>No files changed</Text>
          </View>
        ) : (
          tree.map((item) => (
            <TreeItem
              key={item.path}
              item={item}
              depth={0}
              selectedFiles={selectedFiles}
              onFileSelect={onFileSelect}
              onFilePress={onFilePress}
              selectable={selectable}
              expandedPaths={expandedPaths}
              onToggle={handleToggle}
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}
