import { Pressable, Text, View, useWindowDimensions } from "react-native"
import { Menu } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { DrawerMenu } from "@/components/layout/DrawerMenu"
import { StatusPill } from "@/components/layout/StatusPill"
import { getCurrentProjectLabel, getCurrentTab, getGitHubStatusLabel } from "@/components/layout/navigation.config"
import { useServer } from "@/lib/server-provider"
import { useUIStore } from "@/lib/store"

type AppHeaderProps = {
  routeName: string
}

export function AppHeader({ routeName }: AppHeaderProps) {
  const { top } = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { bootstrap, config } = useServer()
  const current = getCurrentTab(routeName)
  const openDrawer = useUIStore((state) => state.openDrawer)
  const compact = width < 390
  const workspaceLabel = getCurrentProjectLabel(bootstrap, "None")
  const executionValue =
    config?.executionTarget === "container"
      ? bootstrap?.execution?.container?.available
        ? "Container"
        : "Container off"
      : "Local"
  const controlStatus = !config
    ? "Host offline"
    : !bootstrap?.github?.connected
      ? "GitHub attention"
      : "Control plane live"
  const controlTone = !config ? "#fb7185" : !bootstrap?.github?.connected ? "#f59e0b" : "#34d399"

  return (
    <>
      <View className="border-b border-border bg-background px-4 pb-2" style={{ paddingTop: top + 4 }}>
        <View className="overflow-hidden rounded-[20px] border border-border bg-surface px-3 py-2.5">
          <View className="absolute -right-8 -top-8 h-14 w-14 rounded-full bg-accent/10" />
          <View className="absolute bottom-0 left-0 h-6 w-full bg-panel/14" />

          <View className="flex-row items-center justify-between gap-2">
            <View className="min-w-0 flex-1 flex-row items-center gap-2">
              <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: controlTone }} />
              <Text className="text-[9px] font-semibold uppercase tracking-[1.4px] text-soft">{controlStatus}</Text>
              <Text className="text-[9px] font-semibold uppercase tracking-[1.4px] text-accent-light">
                {current.label}
              </Text>
            </View>
            <Pressable
              onPress={openDrawer}
              className="rounded-[13px] border border-border bg-background/80 px-2.5 py-2"
            >
              <Menu size={15} color="#e6eef8" strokeWidth={2.2} />
            </Pressable>
          </View>

          <View className={`mt-2 items-center gap-2 ${compact ? "" : "flex-row justify-between"}`}>
            <View className="min-w-0 flex-1">
              <Text
                className={`font-semibold text-ink ${compact ? "text-[16px] leading-[19px]" : "text-[17px] leading-[20px]"}`}
              >
                Mobile operations
              </Text>
              <Text className="mt-0.5 text-[11px] leading-4 text-soft" numberOfLines={1}>
                {current.subtitle}
              </Text>
            </View>

            <View className="min-w-0 rounded-[13px] border border-border/80 bg-background/80 px-2.5 py-1.5">
              <Text className="text-[8px] font-semibold uppercase tracking-[1.2px] text-accent-light">Workspace</Text>
              <Text selectable className="mt-0.5 text-[10px] font-semibold text-ink" numberOfLines={1}>
                {workspaceLabel}
              </Text>
              <Text className="mt-0.5 text-[8px] text-soft">{executionValue}</Text>
            </View>
          </View>

          <View className="mt-2 flex-row flex-wrap gap-1.5">
            <StatusPill label="Host" value={config ? "Connected" : "Offline"} tone={config ? "good" : "warn"} compact />
            <StatusPill
              label="GitHub"
              value={getGitHubStatusLabel(bootstrap, "Awaiting auth")}
              tone={bootstrap?.github?.connected ? "good" : "warn"}
              compact
            />
            <StatusPill
              label="Run"
              value={executionValue}
              tone={config?.executionTarget === "container" ? "good" : "neutral"}
              compact
            />
          </View>
        </View>
      </View>
      <DrawerMenu routeName={routeName} />
    </>
  )
}
