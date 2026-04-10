import { Text, View } from "react-native"
import type { GitFileStatus } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

type StatusType = GitFileStatus["status"]

interface GitFileStatusBadgeProps {
  status: StatusType
  additions?: number
  deletions?: number
  compact?: boolean
}

const STATUS_CONFIG: Record<
  StatusType,
  {
    label: string
    lightBg: string
    darkBg: string
    lightBorder: string
    darkBorder: string
    lightText: string
    darkText: string
  }
> = {
  added: {
    label: "A",
    lightBg: "rgba(34,197,94,0.12)",
    darkBg: "rgba(34,197,94,0.15)",
    lightBorder: "rgba(34,197,94,0.25)",
    darkBorder: "rgba(34,197,94,0.35)",
    lightText: "#16a34a",
    darkText: "#4ade80",
  },
  modified: {
    label: "M",
    lightBg: "rgba(14,165,233,0.12)",
    darkBg: "rgba(14,165,233,0.15)",
    lightBorder: "rgba(14,165,233,0.25)",
    darkBorder: "rgba(14,165,233,0.35)",
    lightText: "#0ea5e9",
    darkText: "#38bdf8",
  },
  deleted: {
    label: "D",
    lightBg: "rgba(239,68,68,0.12)",
    darkBg: "rgba(239,68,68,0.15)",
    lightBorder: "rgba(239,68,68,0.25)",
    darkBorder: "rgba(239,68,68,0.35)",
    lightText: "#dc2626",
    darkText: "#f87171",
  },
  renamed: {
    label: "R",
    lightBg: "rgba(168,85,247,0.12)",
    darkBg: "rgba(168,85,247,0.15)",
    lightBorder: "rgba(168,85,247,0.25)",
    darkBorder: "rgba(168,85,247,0.35)",
    lightText: "#a855f7",
    darkText: "#c084fc",
  },
  untracked: {
    label: "U",
    lightBg: "rgba(107,114,128,0.12)",
    darkBg: "rgba(107,114,128,0.15)",
    lightBorder: "rgba(107,114,128,0.25)",
    darkBorder: "rgba(107,114,128,0.35)",
    lightText: "#6b7280",
    darkText: "#9ca3af",
  },
}

export function GitFileStatusBadge({ status, additions = 0, deletions = 0, compact = false }: GitFileStatusBadgeProps) {
  const { isDark } = useAppTheme()
  const config = STATUS_CONFIG[status]

  const backgroundColor = isDark ? config.darkBg : config.lightBg
  const borderColor = isDark ? config.darkBorder : config.lightBorder
  const textColor = isDark ? config.darkText : config.lightText

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
          backgroundColor,
          borderWidth: 1,
          borderColor,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontSize: compact ? 9 : 11,
            fontWeight: "800",
            color: textColor,
            letterSpacing: 0.5,
          }}
        >
          {config.label}
        </Text>
      </View>
      {!compact && (additions > 0 || deletions > 0) && (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {additions > 0 && (
            <Text
              style={{
                fontSize: 10,
                fontWeight: "600",
                color: "#22c55e",
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
                color: "#ef4444",
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
