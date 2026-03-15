import { ActivityIndicator, Linking, Text, View } from "react-native"
import { relativeTime, type SessionDetail } from "@/lib/types"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"

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

  return (
    <View className="pb-4">
      <SurfaceCard
        eyebrow="Execution timeline"
        title={title}
        description={location}
        className="px-5 py-5"
      >
        <View className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/15" />
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={status} tone={currentStatusTone(status)} />
          <InfoChip label={`${messageCount} messages`} />
          <InfoChip label={`${approvalCount} approvals`} tone={approvalCount ? "warn" : "neutral"} />
          <InfoChip label={`${fileCount} files`} />
          <InfoChip label={`+${additions} / -${deletions}`} tone={additions || deletions ? "accent" : "neutral"} />
          {github?.headBranch ? <InfoChip label={github.headBranch} /> : null}
          {updatedAt ? <InfoChip label={`Updated ${relativeTime(updatedAt)}`} /> : null}
        </View>

        {github ? (
          <View className="mt-4 rounded-[24px] border border-border bg-background/65 px-4 py-4">
            <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">GitHub publish path</Text>
            <Text className="mt-2 text-sm leading-6 text-soft">
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
                  onPress={() => void Linking.openURL(github.pullRequest!.url)}
                />
              </View>
            ) : null}
            <View className="flex-1">
              <ActionButton label="Abort session" variant="secondary" onPress={onAbort} />
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
