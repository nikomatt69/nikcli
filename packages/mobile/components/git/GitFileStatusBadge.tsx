import { Text, View } from "react-native"
import type { GitFileStatus } from "@/lib/types"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type StatusType = GitFileStatus["status"]

interface GitFileStatusBadgeProps {
  status: StatusType
  additions?: number
  deletions?: number
  compact?: boolean
}

const STATUS_LABEL: Record<StatusType, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
}

export function GitFileStatusBadge({ status, additions = 0, deletions = 0, compact = false }: GitFileStatusBadgeProps) {
  const { palette } = useAppTheme()
  const color =
    status === "added"
      ? palette.success
      : status === "deleted"
        ? palette.danger
        : status === "modified"
          ? palette.accent
          : status === "renamed"
            ? palette.warn
            : palette.muted

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 4 : 6,
      }}
    >
      <View
        style={{
          width: compact ? 18 : 22,
          height: compact ? 18 : 22,
          borderRadius: 5,
          backgroundColor: hexToRgba(color, 0.14),
          borderWidth: 1,
          borderColor: hexToRgba(color, 0.28),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontSize: compact ? 9 : 11,
            fontWeight: "800",
            color,
            letterSpacing: 0.5,
          }}
        >
          {STATUS_LABEL[status]}
        </Text>
      </View>
      {!compact && (additions > 0 || deletions > 0) && (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {additions > 0 && (
            <Text
              style={{
                fontSize: 10,
                fontWeight: "600",
                color: palette.success,
                fontVariant: ["tabular-nums"],
              }}
            >
              +{additions}
            </Text>
          )}
          {deletions > 0 && (
            <Text
              style={{
                fontSize: 10,
                fontWeight: "600",
                color: palette.danger,
                fontVariant: ["tabular-nums"],
              }}
            >
              -{deletions}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}
