import { Pressable, Text, View } from "react-native"
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
  const { bootstrap, config } = useServer()
  const current = getCurrentTab(routeName)
  const openDrawer = useUIStore((state) => state.openDrawer)

  return (
    <>
      <View className="border-b border-border bg-background px-4 pb-4" style={{ paddingTop: top + 8 }}>
        <View className="overflow-hidden rounded-[30px] border border-border bg-surface px-4 py-4">
          <View className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/15" />
          <View className="absolute bottom-0 left-0 h-20 w-full bg-panel/25" />
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-[11px] font-semibold uppercase tracking-[2.1px] text-accent-light">
                Enterprise control plane
              </Text>
              <Text className="mt-2 text-[28px] font-semibold leading-[31px] text-ink">{current.label}</Text>
              <Text className="mt-2 text-sm leading-6 text-soft">{current.subtitle}</Text>
            </View>
            <Pressable
              onPress={openDrawer}
              className="rounded-2xl border border-border bg-background/75 px-3 py-3"
            >
              <Menu size={20} color="#e6eef8" strokeWidth={2.2} />
            </Pressable>
          </View>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <StatusPill label="Host" value={config ? "Connected" : "Offline"} tone={config ? "good" : "warn"} />
            <StatusPill
              label="GitHub"
              value={getGitHubStatusLabel(bootstrap, "Awaiting auth")}
              tone={bootstrap?.github?.connected ? "good" : "warn"}
            />
            <StatusPill label="Repo" value={getCurrentProjectLabel(bootstrap, "None")} />
          </View>
        </View>
      </View>
      <DrawerMenu routeName={routeName} />
    </>
  )
}
