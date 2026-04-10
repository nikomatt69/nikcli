import { Pressable, Text, View } from "react-native"
import { GitBranch, RefreshCw } from "lucide-react-native"
import type { GitState } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

interface GitStatusBarProps {
  gitState: GitState | null
  loading?: boolean
  onPress?: () => void
  onRefresh?: () => void
}

export function GitStatusBar({ gitState, loading = false, onPress, onRefresh }: GitStatusBarProps) {
  const { palette, isDark } = useAppTheme()

  if (!gitState) {
    if (loading) {
      return (
        <Pressable
          onPress={onPress}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <GitBranch size={13} color={palette.accentLight} strokeWidth={2} />
          <Text style={{ fontSize: 11, fontWeight: "600", color: palette.ink }}>...</Text>
        </Pressable>
      )
    }
    return null
  }

  const stagedCount = gitState.staged.length
  const unstagedCount = gitState.unstaged.length
  const untrackedCount = gitState.untracked.length
  const totalChanges = stagedCount + unstagedCount + untrackedCount
  const ahead = gitState.commitsAhead
  const behind = gitState.commitsBehind

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
      <GitBranch size={13} color={palette.accentLight} strokeWidth={2} />
      <Text style={{ fontSize: 11, fontWeight: "600", color: palette.ink }}>{gitState.branch}</Text>

      {totalChanges > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 1, height: 12, backgroundColor: palette.border }} />
          {stagedCount > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" }} />
              <Text style={{ fontSize: 10, fontWeight: "600", color: "#22c55e" }}>{stagedCount}</Text>
            </View>
          )}
          {unstagedCount > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} />
              <Text style={{ fontSize: 10, fontWeight: "600", color: "#f59e0b" }}>{unstagedCount}</Text>
            </View>
          )}
          {untrackedCount > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#6b7280" }} />
              <Text style={{ fontSize: 10, fontWeight: "600", color: "#6b7280" }}>{untrackedCount}</Text>
            </View>
          )}
        </View>
      )}

      {ahead > 0 && (
        <>
          <View style={{ width: 1, height: 12, backgroundColor: palette.border }} />
          <Text style={{ fontSize: 10, fontWeight: "600", color: "#3b82f6" }}>↑{ahead}</Text>
        </>
      )}

      {behind > 0 && (
        <>
          <View style={{ width: 1, height: 12, backgroundColor: palette.border }} />
          <Text style={{ fontSize: 10, fontWeight: "600", color: "#f59e0b" }}>↓{behind}</Text>
        </>
      )}

      <Pressable
        onPress={(e) => {
          e.stopPropagation()
          onRefresh?.()
        }}
        hitSlop={6}
        style={{
          marginLeft: "auto",
          width: 24,
          height: 24,
          borderRadius: 6,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RefreshCw
          size={12}
          color={palette.muted}
          style={{
            opacity: loading ? 0.5 : 1,
          }}
        />
      </Pressable>
    </Pressable>
  )
}
