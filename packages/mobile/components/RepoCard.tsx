import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { InfoChip } from "@/components/ui/InfoChip"
import type { GitHubRepo, ProjectInfo } from "@/lib/types"
import { relativeTime } from "@/lib/types"
import { hexToRgba, useAppTheme } from "@/lib/theme"

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
  const [pressed, setPressed] = useState(false)

  return (
    <Pressable
      onPress={props.onSelect}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className="overflow-hidden p-4"
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.selected ? hexToRgba(palette.ink, 0.3) : hexToRgba(palette.ink, 0.08),
        backgroundColor: props.selected ? palette.panel : palette.surface,
        opacity: pressed ? 0.88 : 1,
      }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <Text selectable className="text-[12px] font-medium text-muted">
            {props.project.current ? "Live workspace" : "Available workspace"}
          </Text>
          <Text selectable className="text-base font-semibold text-ink">
            {projectLabel(props.project)}
          </Text>
          <Text selectable className="text-sm leading-5 text-soft">
            {props.project.worktree || "Unknown path"}
          </Text>
        </View>
        {props.project.current ? <InfoChip label="Current" tone="accent" /> : null}
      </View>
      <View className="mt-4 flex-row flex-wrap gap-2">
        <InfoChip label={`${props.project.sandboxes.length} sandboxes`} />
        {props.selected ? <InfoChip label="Selected on mobile" tone="accent" /> : null}
      </View>
      {props.onStartSession ? (
        <View className="mt-3">
          <ActionButton
            label={props.startingSession ? "Starting session..." : "Start session here"}
            loading={props.startingSession}
            variant={props.selected ? "primary" : "secondary"}
            onPress={props.onStartSession}
          />
        </View>
      ) : null}
    </Pressable>
  )
}

export function GithubRepoCard(props: { repo: GitHubRepo }) {
  const { palette } = useAppTheme()

  return (
    <View
      className="overflow-hidden p-4"
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.ink, 0.08),
        backgroundColor: palette.surface,
      }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <Text selectable className="text-[12px] font-medium text-muted">
            GitHub source
          </Text>
          <Text selectable className="text-base font-semibold text-ink">
            {repoLabel(props.repo)}
          </Text>
        </View>
        {props.repo.imported ? <InfoChip label="Imported" tone="good" /> : null}
      </View>
      {props.repo.description ? (
        <Text selectable className="mt-2 text-sm leading-6 text-soft">
          {props.repo.description}
        </Text>
      ) : null}
      <View className="mt-4 flex-row flex-wrap gap-2">
        <InfoChip label={branchLabel(props.repo.default_branch)} />
        {props.repo.language ? <InfoChip label={props.repo.language} tone="neutral" /> : null}
        <InfoChip label={`${props.repo.stargazers_count.toLocaleString()} stars`} tone="accent" />
        {props.repo.updated_at ? <InfoChip label={relativeTime(new Date(props.repo.updated_at).getTime())} /> : null}
      </View>
    </View>
  )
}
