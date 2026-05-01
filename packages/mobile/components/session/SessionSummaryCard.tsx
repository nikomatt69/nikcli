import { Linking, Text, View } from "react-native"
import { relativeTime } from "@/lib/text-utils"
import { type SessionDetail } from "@/lib/types"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useAppTheme } from "@/lib/theme"

type SessionSummaryCardProps = {
  detail: SessionDetail | null
  sessionBlocked: boolean
  cleaned: boolean
  cleaning: boolean
  error?: string | null
  onPublish(): void
  onAbort(): void
  onCleanup(): void
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
        : "rgba(14,165,233,0.08)"
      : props.tone === "good"
        ? isDark
          ? "rgba(212,212,212,0.06)"
          : "rgba(34,197,94,0.08)"
        : props.tone === "warn"
          ? isDark
            ? "rgba(143,143,143,0.06)"
            : "rgba(239,68,68,0.08)"
          : isDark
            ? "rgba(255,255,255,0.04)"
            : "rgba(241,246,251,0.78)"

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.7)",
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
}: SessionSummaryCardProps) {
  const { palette, isDark } = useAppTheme()
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
      <SurfaceCard eyebrow="Execution timeline" title={title} description={location} className="px-5 py-5">
        <View className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/15" />
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
            className="mt-4 rounded-[24px] border px-4 py-4"
            style={{
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.72)",
              backgroundColor: isDark ? "rgba(0,0,0,0.45)" : "rgba(241,246,251,0.68)",
            }}
          >
            <Text selectable className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
              GitHub publish path
            </Text>
            <Text selectable className="mt-2 text-sm leading-6 text-soft">
              {github.pullRequest
                ? `This session already tracks PR #${github.pullRequest.number}. You can update the branch or reopen the PR directly from mobile.`
                : `Base branch ${github.baseBranch} -> head branch ${github.headBranch}. Publish when the worktree is ready.`}
            </Text>
          </View>
        ) : null}

        <View className="mt-4 gap-2">
          {github ? (
            <ActionButton
              label={github.pullRequest ? "Update pull request" : "Publish pull request"}
              disabled={sessionBlocked || cleaned}
              onPress={onPublish}
            />
          ) : null}

          <View className="flex-row gap-2">
            {github?.pullRequest ? (
              <View className="flex-1">
                <ActionButton
                  label="Open PR"
                  variant="secondary"
                  onPress={() => void Linking.openURL(github.pullRequest?.url ?? "")}
                />
              </View>
            ) : null}
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
