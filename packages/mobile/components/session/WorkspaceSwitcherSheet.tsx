import type { RefObject } from "react"
import { useRef } from "react"
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, View } from "react-native"
import { Check, Folder, GitBranch, type LucideIcon } from "lucide-react-native"
import { ActionSheet, ActionSheetDivider, type ActionSheetRef } from "@/components/BottomSheet"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import type { ProjectInfo } from "@/lib/types"

type Props = {
  sheetRef: RefObject<ActionSheetRef | null>
  projects: ProjectInfo[]
  selectedDirectory?: string
  switchingDirectory: string | null
  onSelect(directory: string): void
}

type RowProps = {
  Icon: LucideIcon
  label: string
  description: string
  selected: boolean
  loading: boolean
  disabled: boolean
  onPress(): void
}

function lastPathSegment(path?: string): string {
  if (!path) return "Unknown workspace"
  const segments = path.split("/").filter(Boolean)
  return segments[segments.length - 1] || path
}

function projectLabel(project: ProjectInfo): string {
  return project.name || lastPathSegment(project.worktree)
}

function SectionLabel({ label }: { label: string }) {
  return <Text className="px-5 pb-1 pt-3.5 text-[12px] font-medium text-muted">{label}</Text>
}

function SectionDivider() {
  return <View className="mx-5 mt-2 h-px bg-border" />
}

function WorkspaceRow({ Icon, label, description, selected, loading, disabled, onPress }: RowProps) {
  const { palette } = useAppTheme()
  const scaleAnimRef = useRef<Animated.Value | null>(null)
  if (scaleAnimRef.current === null) scaleAnimRef.current = new Animated.Value(1)
  const scaleAnim = scaleAnimRef.current

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      damping: 20,
      stiffness: 280,
      mass: 0.85,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 18,
      stiffness: 300,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  const iconColor = selected ? palette.accentLight : palette.muted
  const iconBg = selected ? hexToRgba(palette.accentLight, 0.1) : hexToRgba(palette.ink, 0.08)
  const iconBorder = selected ? hexToRgba(palette.accentLight, 0.2) : hexToRgba(palette.ink, 0.14)

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={`Use workspace ${label}`}
      accessibilityHint={description}
      accessibilityState={{ selected, disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => ({ opacity: disabled || loading ? 0.48 : pressed ? 0.72 : 1 })}
    >
      <Animated.View
        style={{
          width: "100%",
          transform: [{ scale: scaleAnim }],
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          minHeight: 64,
          paddingHorizontal: 20,
          paddingVertical: 10,
        }}
      >
        <View
          className="shrink-0 items-center justify-center rounded-[14px]"
          style={{
            width: 44,
            height: 44,
            backgroundColor: iconBg,
            borderWidth: 1,
            borderColor: iconBorder,
          }}
        >
          <Icon size={19} color={iconColor} strokeWidth={2.1} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold leading-5 tracking-tight text-ink" numberOfLines={1}>
            {label}
          </Text>
          <Text className="mt-0.5 text-[12.5px] leading-4 text-muted" numberOfLines={1}>
            {description}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={palette.accentLight} />
        ) : selected ? (
          <Check size={18} color={palette.accentLight} strokeWidth={2.4} />
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

export function WorkspaceSwitcherSheet({ sheetRef, projects, selectedDirectory, switchingDirectory, onSelect }: Props) {
  const { palette } = useAppTheme()

  return (
    <ActionSheet ref={sheetRef} snapPoints={["72%"]}>
      <View className="border-b border-border px-5 pb-4">
        <Text className="text-[12px] font-medium text-muted">Current workspace</Text>
        <Text className="mt-1.5 text-lg font-bold leading-6 tracking-tight text-ink" numberOfLines={1}>
          {lastPathSegment(selectedDirectory)}
        </Text>
        <View className="mt-2 self-start rounded-full border border-border bg-panel px-2.5 py-1">
          <Text className="text-[10px] font-semibold tracking-wide" style={{ color: palette.accentLight }}>
            Switch workspace
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1, width: "100%" }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        bounces
        nestedScrollEnabled
        accessibilityLabel="Workspace list"
      >
        {projects.map((project, projectIndex) => {
          const workspaces = [project.worktree, ...project.sandboxes]
          return (
            <View key={project.id}>
              {projectIndex > 0 ? <SectionDivider /> : null}
              <SectionLabel label={projectLabel(project)} />
              {workspaces.map((directory, index) => {
                const selected = directory === selectedDirectory
                const sandbox = index > 0
                const switching = switchingDirectory === directory
                return (
                  <WorkspaceRow
                    key={directory}
                    Icon={sandbox ? GitBranch : Folder}
                    label={lastPathSegment(directory)}
                    description={sandbox ? `${projectLabel(project)} sandbox` : project.worktree}
                    selected={selected}
                    loading={switching}
                    disabled={switchingDirectory !== null}
                    onPress={() => onSelect(directory)}
                  />
                )
              })}
            </View>
          )
        })}
      </ScrollView>
    </ActionSheet>
  )
}
