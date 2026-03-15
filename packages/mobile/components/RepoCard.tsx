import { ActivityIndicator, Pressable, Text, View } from "react-native"
import type { GitHubRepo, ProjectInfo } from "@/lib/types"
import { relativeTime } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

function lastPathSegment(path?: string): string {
  if (!path) return "Unknown workspace"
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path || "Unknown workspace"
}

function projectLabel(project: ProjectInfo): string {
  return project.name || lastPathSegment(project.worktree)
}

function repoLabel(repo: GitHubRepo): string {
  return repo.full_name || "Unknown repository"
}

function branchLabel(branch?: string): string {
  return branch || "unknown-branch"
}

export function LocalRepoCard(props: {
  project: ProjectInfo
  selected?: boolean
  onSelect(): void
  onStartSession?: () => void
  startingSession?: boolean
}) {
  const { palette } = useAppTheme()

  return (
    <Pressable
      onPress={props.onSelect}
      className={`rounded-[30px] border px-4 py-4 ${props.selected ? "border-accent/40 bg-panel" : "border-border bg-surface"}`}
      style={{
        shadowColor: palette.shadow,
        shadowOpacity: 0.18,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-[2.1px] text-accent-light">
            {props.project.current ? "Live workspace" : "Available workspace"}
          </Text>
          <Text className="text-base font-semibold text-ink">{projectLabel(props.project)}</Text>
          <Text className="text-sm leading-5 text-soft">{props.project.worktree || "Unknown path"}</Text>
        </View>
        {props.project.current ? (
          <View className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5">
            <Text className="text-[10px] font-semibold uppercase tracking-[1.8px] text-accent-light">Current</Text>
          </View>
        ) : null}
      </View>
      <View className="mt-4 flex-row flex-wrap gap-2">
        <View className="rounded-full border border-border/60 bg-background/75 px-3 py-2">
          <Text className="text-[11px] font-semibold text-ink">{props.project.sandboxes.length} sandboxes</Text>
        </View>
        {props.selected ? (
          <View className="rounded-full border border-accent/20 bg-accent/10 px-3 py-2">
            <Text className="text-[11px] font-semibold text-accent-light">Selected on mobile</Text>
          </View>
        ) : null}
      </View>
      {props.onStartSession ? (
        <Pressable
          disabled={props.startingSession}
          onPress={props.onStartSession}
          className="mt-3 rounded-[20px] border border-border bg-background/70 px-4 py-3"
        >
          {props.startingSession ? (
            <ActivityIndicator color={palette.accent} size="small" />
          ) : (
            <Text className="text-center text-sm font-semibold text-ink">Start session here</Text>
          )}
        </Pressable>
      ) : null}
    </Pressable>
  )
}

export function GithubRepoCard(props: { repo: GitHubRepo }) {
  return (
    <View className="rounded-[30px] border border-border bg-background/55 px-4 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-[2.1px] text-accent-light">GitHub source</Text>
          <Text className="text-base font-semibold text-ink">{repoLabel(props.repo)}</Text>
        </View>
        {props.repo.imported ? (
          <View className="rounded-full border border-success/35 bg-success/10 px-3 py-1.5">
            <Text className="text-[10px] font-semibold uppercase tracking-[1.8px] text-emerald-200">Imported</Text>
          </View>
        ) : null}
      </View>
      {props.repo.description ? (
        <Text className="mt-2 text-sm leading-6 text-soft">{props.repo.description}</Text>
      ) : null}
      <View className="mt-4 flex-row flex-wrap gap-2">
        <View className="rounded-full border border-border/60 bg-surface px-3 py-2">
          <Text className="text-[11px] font-semibold text-ink">{branchLabel(props.repo.default_branch)}</Text>
        </View>
        {props.repo.language ? (
          <View className="rounded-full border border-border/60 bg-surface px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">{props.repo.language}</Text>
          </View>
        ) : null}
        <View className="rounded-full border border-border/60 bg-surface px-3 py-2">
          <Text className="text-[11px] font-semibold text-ink">{props.repo.stargazers_count} stars</Text>
        </View>
        {props.repo.updated_at ? (
          <View className="rounded-full border border-border/60 bg-surface px-3 py-2">
            <Text className="text-[11px] font-semibold text-soft">
              {relativeTime(new Date(props.repo.updated_at).getTime())}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}
