import { Linking, Text, View } from "react-native"
import { GitPullRequest } from "lucide-react-native"
import { relativeTime, type SessionDetail } from "@/lib/types"
import { ActionButton } from "@/components/ui/ActionButton"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

type SessionSummaryCardProps = {
  detail: SessionDetail | null
  sessionBlocked: boolean
  cleaned: boolean
  cleaning: boolean
  onPublish(): void
  onAbort(): void
  onCleanup(): void
  /** Opens the full git review modal (stage, commit, push, pull, diff). */
  onOpenGit?(): void
}

function statusLabel(status?: string) {
  if (status === "busy") return "Running"
  if (status === "retry") return "Retrying"
  if (status === "idle") return "Idle"
  if (!status) return "Idle"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function statusTone(status?: string) {
  if (status === "busy") return "accent" as const
  if (status === "retry") return "warn" as const
  return "good" as const
}

function formatCompactCount(value: number) {
  if (value < 1000) return String(value)
  if (value < 1_000_000) {
    const scaled = value / 1000
    const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, "")
    return `${text}k`
  }
  const scaled = value / 1_000_000
  const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, "")
  return `${text}M`
}

function workspaceLabel(detail: SessionDetail | null) {
  const github = detail?.info.github
  if (github?.fullName) return github.fullName
  const directory = detail?.info.worktree?.directory || detail?.info.directory
  if (!directory || directory === "/") return "Workspace root"
  return directory.split("/").filter(Boolean).pop() || directory
}

function Metric(props: { label: string; value: string; warn?: boolean; last?: boolean }) {
  const { palette } = useAppTheme()
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        paddingHorizontal: 4,
        borderRightWidth: props.last ? 0 : 1,
        borderRightColor: hexToRgba(palette.ink, 0.08),
      }}
    >
      <Text selectable style={{ color: palette.muted, ...typeStyle(11, { weight: "600" }) }}>
        {props.label}
      </Text>
      <Text
        selectable
        style={{
          marginTop: 3,
          color: props.warn ? palette.warn : palette.ink,
          fontVariant: ["tabular-nums"],
          ...typeStyle(20, { weight: "700" }),
        }}
      >
        {props.value}
      </Text>
    </View>
  )
}

export function SessionSummaryCard({
  detail,
  sessionBlocked,
  cleaned,
  cleaning,
  onPublish,
  onAbort,
  onCleanup,
  onOpenGit,
}: SessionSummaryCardProps) {
  const { palette } = useAppTheme()
  const title = detail?.info.title || "Session"
  const github = detail?.info.github
  const worktree = detail?.info.worktree
  const location = workspaceLabel(detail)
  const status = detail?.status?.type ?? "idle"
  const messageCount = detail?.messages.length ?? 0
  const approvalCount = detail?.permissions.length ?? 0
  const fileCount = detail?.info.summary?.files ?? 0
  const additions = detail?.info.summary?.additions ?? 0
  const deletions = detail?.info.summary?.deletions ?? 0
  const updatedAt = detail?.info.time.updated
  const executionLabel = detail?.info.workspaceID ? "Container sandbox" : "Local worktree"
  const branch = github?.headBranch || worktree?.branch
  const hasDiff = additions > 0 || deletions > 0

  const totalTokens =
    detail?.messages
      .filter((m) => m.info.role === "assistant")
      .reduce((sum, m) => {
        const t = (
          m.info as { tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number } } }
        ).tokens
        return sum + (t?.input ?? 0) + (t?.output ?? 0) + (t?.reasoning ?? 0) + (t?.cache?.read ?? 0)
      }, 0) ?? 0

  const totalCost =
    detail?.messages
      .filter((m) => m.info.role === "assistant")
      .reduce((sum, m) => sum + ((m.info as { cost?: number }).cost ?? 0), 0) ?? 0

  const meta = [executionLabel, updatedAt ? `Updated ${relativeTime(updatedAt)}` : null].filter(Boolean).join(" · ")

  return (
    <View className="pb-4">
      <SurfaceCard>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <InfoChip label={statusLabel(status)} tone={statusTone(status)} />
          {approvalCount > 0 ? <InfoChip label={`${approvalCount} pending`} tone="warn" /> : null}
        </View>

        <Text selectable style={{ marginTop: 12, color: palette.ink, ...typeStyle(22, { weight: "700" }) }}>
          {title}
        </Text>
        <Text selectable style={{ marginTop: 4, color: palette.ink, ...typeStyle(15) }} numberOfLines={1}>
          {location}
        </Text>
        {meta ? (
          <Text selectable style={{ marginTop: 2, color: palette.muted, ...typeStyle(13) }} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}

        <View
          style={{
            marginTop: 16,
            flexDirection: "row",
            paddingVertical: 12,
            paddingHorizontal: 8,
            borderRadius: 14,
            borderCurve: "continuous",
            backgroundColor: hexToRgba(palette.ink, 0.035),
          }}
        >
          <Metric label="Messages" value={formatCompactCount(messageCount)} />
          <Metric label="Approvals" value={formatCompactCount(approvalCount)} warn={approvalCount > 0} />
          <Metric label="Files" value={formatCompactCount(fileCount)} />
          <Metric
            label={totalCost > 0 ? "Cost" : "Context"}
            value={totalCost > 0 ? `$${totalCost.toFixed(2)}` : formatCompactCount(totalTokens)}
            last
          />
        </View>

        {branch || hasDiff || totalCost > 0 ? (
          <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {branch ? <InfoChip label={branch} /> : null}
            {hasDiff ? (
              <InfoChip label={`+${additions} / −${deletions}`} tone="accent" />
            ) : null}
            {totalCost > 0 && totalTokens > 0 ? <InfoChip label={`${formatCompactCount(totalTokens)} ctx`} /> : null}
          </View>
        ) : null}

        {github ? (
          <View
            className="mt-4 p-4"
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: hexToRgba(palette.ink, 0.08),
              backgroundColor: palette.surfaceRaised,
            }}
          >
            <View className="flex-row items-center gap-2">
              <GitPullRequest
                size={15}
                color={github.pullRequest ? palette.success : palette.muted}
                strokeWidth={2.2}
              />
              {github.pullRequest ? (
                <>
                  <Text selectable className="flex-1 text-[15px] font-semibold text-ink" numberOfLines={1}>
                    #{github.pullRequest.number} {github.pullRequest.title}
                  </Text>
                  <InfoChip label="Open" tone="good" />
                </>
              ) : (
                <Text selectable className="flex-1 text-[15px] font-semibold text-ink" numberOfLines={1}>
                  No pull request yet
                </Text>
              )}
            </View>

            <Text selectable className="mt-2 text-[13px] leading-5 text-muted" numberOfLines={1}>
              {github.headBranch} → {github.baseBranch}
              {hasDiff ? "  ·  " : ""}
              {additions ? <Text style={{ color: palette.success }}>+{additions} </Text> : null}
              {deletions ? <Text style={{ color: palette.danger }}>−{deletions}</Text> : null}
            </Text>

            <View className="mt-3 gap-2">
              <ActionButton
                label={github.pullRequest ? "Update pull request" : "Publish pull request"}
                disabled={sessionBlocked || cleaned}
                onPress={onPublish}
              />
              <View className="flex-row gap-2">
                {onOpenGit ? (
                  <View className="flex-1">
                    <ActionButton label="Review changes" variant="secondary" onPress={onOpenGit} />
                  </View>
                ) : null}
                {github.pullRequest ? (
                  <View className="flex-1">
                    <ActionButton
                      label="Open on GitHub"
                      variant="secondary"
                      onPress={() => void Linking.openURL(github.pullRequest?.url ?? "")}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        <View className="mt-4 gap-2">
          {!github && onOpenGit ? (
            <ActionButton label="Review changes" variant="secondary" onPress={onOpenGit} />
          ) : null}
          {sessionBlocked || github || worktree ? (
            <View className="flex-row gap-2">
              {sessionBlocked ? (
                <View className="flex-1">
                  <ActionButton label="Abort session" variant="danger" onPress={onAbort} />
                </View>
              ) : null}
              {github || worktree ? (
                <View className="flex-1">
                  <ActionButton
                    label={cleaning ? "Cleaning..." : cleaned ? "Cleaned" : "Cleanup"}
                    variant="secondary"
                    loading={cleaning}
                    disabled={cleaning || sessionBlocked || cleaned}
                    onPress={onCleanup}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </SurfaceCard>
    </View>
  )
}
