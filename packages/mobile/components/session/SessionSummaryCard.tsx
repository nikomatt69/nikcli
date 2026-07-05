import { Linking, Text, View } from "react-native"
import { GitPullRequest } from "lucide-react-native"
import { relativeTime, type SessionDetail } from "@/lib/types"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type SessionSummaryCardProps = {
  detail: SessionDetail | null
  sessionBlocked: boolean
  cleaned: boolean
  cleaning: boolean
  error?: string | null
  onPublish(): void
  onAbort(): void
  onCleanup(): void
  /** Opens the full git review modal (stage, commit, push, pull, diff). */
  onOpenGit?(): void
}

function currentStatusTone(status?: string) {
  if (status === "busy") return "accent" as const
  if (status === "retry") return "warn" as const
  return "good" as const
}

function MetricTile(props: { label: string; value: string; tone?: "neutral" | "accent" | "good" | "warn" }) {
  const { palette, isDark } = useAppTheme()
  const backgroundColor =
    props.tone === "accent"
      ? isDark
        ? "rgba(255,255,255,0.06)"
        : "rgba(20,20,19,0.08)"
      : props.tone === "good"
        ? isDark
          ? "rgba(212,212,212,0.06)"
          : "rgba(31,138,101,0.08)"
        : props.tone === "warn"
          ? isDark
            ? "rgba(143,143,143,0.06)"
            : "rgba(207,45,86,0.08)"
          : isDark
            ? "rgba(255,255,255,0.04)"
            : "rgba(247,246,242,0.78)"

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(218,216,209,0.7)",
        backgroundColor,
        paddingHorizontal: 12,
        paddingVertical: 11,
      }}
    >
      <Text
        selectable
        style={{ fontSize: 10, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", color: palette.soft }}
      >
        {props.label}
      </Text>
      <Text
        selectable
        style={{
          marginTop: 4,
          fontSize: 16,
          fontWeight: "700",
          color: palette.ink,
          fontVariant: ["tabular-nums"],
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
  error,
  onPublish,
  onAbort,
  onCleanup,
  onOpenGit,
}: SessionSummaryCardProps) {
  const { palette } = useAppTheme()
  const title = detail?.info.title || "Session"
  const github = detail?.info.github
  const location = github?.fullName || detail?.info.directory || "Unknown workspace"
  const status = detail?.status?.type ?? "idle"
  const messageCount = detail?.messages.length ?? 0
  const approvalCount = detail?.permissions.length ?? 0
  const fileCount = detail?.info.summary?.files ?? 0
  const additions = detail?.info.summary?.additions ?? 0
  const deletions = detail?.info.summary?.deletions ?? 0
  const updatedAt = detail?.info.time.updated
  const executionLabel = detail?.info.workspaceID ? "Container sandbox" : "Local worktree"

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

  return (
    <View className="pb-4">
      <SurfaceCard eyebrow="Execution timeline" title={title} description={location} className="p-5">
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={status} tone={currentStatusTone(status)} />
          <InfoChip label={`${messageCount} messages`} />
          <InfoChip label={`${approvalCount} approvals`} tone={approvalCount ? "warn" : "neutral"} />
          <InfoChip label={`${fileCount} files`} />
          <InfoChip label={`+${additions} / -${deletions}`} tone={additions || deletions ? "accent" : "neutral"} />
          <InfoChip label={executionLabel} tone={detail?.info.workspaceID ? "accent" : "neutral"} />
          {github?.headBranch ? <InfoChip label={github.headBranch} /> : null}
          {updatedAt ? <InfoChip label={`Updated ${relativeTime(updatedAt)}`} /> : null}
          {totalTokens > 0 ? <InfoChip label={`${totalTokens.toLocaleString()} ctx`} tone="neutral" /> : null}
          {totalCost > 0 ? <InfoChip label={`$${totalCost.toFixed(4)}`} tone="neutral" /> : null}
        </View>

        <View className="mt-4 flex-row flex-wrap gap-2">
          <MetricTile label="Messages" value={messageCount.toLocaleString()} tone="neutral" />
          <MetricTile label="Approvals" value={approvalCount.toLocaleString()} tone={approvalCount ? "warn" : "good"} />
        </View>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <MetricTile
            label="Files touched"
            value={fileCount.toLocaleString()}
            tone={fileCount ? "accent" : "neutral"}
          />
          <MetricTile
            label={totalCost > 0 ? "Cost" : "Context"}
            value={totalCost > 0 ? `$${totalCost.toFixed(4)}` : totalTokens.toLocaleString()}
            tone={totalCost > 0 || totalTokens > 0 ? "accent" : "neutral"}
          />
        </View>

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
            {/* PR header row */}
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

            {/* Branch path */}
            <Text selectable className="mt-2 text-[13px] leading-5 text-muted" numberOfLines={1}>
              {github.headBranch} → {github.baseBranch}
              {additions || deletions ? "  ·  " : ""}
              {additions ? <Text style={{ color: palette.success }}>+{additions} </Text> : null}
              {deletions ? <Text style={{ color: palette.danger }}>-{deletions}</Text> : null}
            </Text>

            {/* Primary: publish / update — the "Squash & Merge"-style ink pill */}
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
          <View className="flex-row gap-2">
            <View className="flex-1">
              <ActionButton label="Abort session" variant="danger" onPress={onAbort} />
            </View>
            {github ? (
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
        </View>
      </SurfaceCard>

      {error ? (
        <View className="mt-4">
          <ErrorBanner message={error} />
        </View>
      ) : null}
    </View>
  )
}
