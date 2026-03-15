import { useEffect, useRef } from "react"
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native"
import { router } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { RefreshCw, X } from "lucide-react-native"
import { StatusPill } from "@/components/layout/StatusPill"
import { APP_TABS, getCurrentProjectLabel, getGitHubStatusLabel } from "@/components/layout/navigation.config"
import { useServer } from "@/lib/server-provider"
import { useUIStore } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"

type DrawerMenuProps = {
  routeName: string
}

export function DrawerMenu({ routeName }: DrawerMenuProps) {
  const { top, bottom } = useSafeAreaInsets()
  const { bootstrap, config, refreshBootstrap } = useServer()
  const { palette, isDark } = useAppTheme()
  const open = useUIStore((state) => state.drawerOpen)
  const closeDrawer = useUIStore((state) => state.closeDrawer)
  const translateX = useRef(new Animated.Value(360)).current
  const overlay = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!open) return
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlay, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start()
  }, [open, overlay, translateX])

  function close() {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 360,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlay, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) closeDrawer()
    })
  }

  function navigate(path: (typeof APP_TABS)[number]["path"]) {
    close()
    router.replace(path)
  }

  return (
    <Modal transparent visible={open} animationType="none" onRequestClose={close}>
      <View className="flex-1">
        <Animated.View
          className="absolute inset-0"
          style={{ opacity: overlay, backgroundColor: isDark ? "rgba(2,6,23,0.7)" : "rgba(15,23,42,0.28)" }}
        />
        <Pressable className="absolute inset-0" onPress={close} />
        <Animated.View
          className="absolute bottom-0 right-0 top-0 w-[86%] border-l border-border bg-background"
          style={{
            paddingTop: top + 14,
            paddingBottom: bottom + 18,
            transform: [{ translateX }],
            shadowColor: palette.shadow,
            shadowOpacity: 0.3,
            shadowRadius: 24,
            shadowOffset: { width: -6, height: 0 },
            elevation: 26,
          }}
        >
          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 18 }}>
            <View className="overflow-hidden rounded-[30px] border border-border bg-surface px-5 py-5">
              <View className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/15" />
              <View className="flex-row items-start justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-[11px] font-semibold uppercase tracking-[2.2px] text-accent-light">
                    Enterprise Nav
                  </Text>
                  <Text className="mt-2 text-[28px] font-semibold leading-[32px] text-ink">
                    Operate your host from anywhere.
                  </Text>
                  <Text className="mt-3 text-sm leading-6 text-soft">
                    Jump between operations, inspect trust posture, and keep GitHub automation aligned with the active
                    host.
                  </Text>
                </View>
                <Pressable onPress={close} className="rounded-2xl border border-border bg-background/75 p-3">
                  <X size={18} color={palette.ink} strokeWidth={2.2} />
                </Pressable>
              </View>
            </View>

            <View className="rounded-[28px] border border-border bg-panel px-4 py-4">
              <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Navigation</Text>
              <View className="mt-4 gap-3">
                {APP_TABS.map((tab) => {
                  const active = routeName === tab.route
                  const Icon = tab.icon
                  return (
                    <Pressable
                      key={tab.route}
                      onPress={() => navigate(tab.path)}
                      className={`rounded-[24px] border px-4 py-4 ${active ? "border-accent/40 bg-accent/10" : "border-border bg-background/55"}`}
                    >
                      <View className="flex-row items-center gap-3">
                        <View className={`rounded-2xl px-3 py-3 ${active ? "bg-accent/15" : "bg-surface"}`}>
                          <Icon
                            size={18}
                            color={active ? palette.accentLight : palette.muted}
                            strokeWidth={active ? 2.2 : 1.9}
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-base font-semibold text-ink">{tab.label}</Text>
                          <Text className="mt-1 text-sm leading-5 text-soft">{tab.subtitle}</Text>
                        </View>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            <View className="rounded-[28px] border border-border bg-surface px-4 py-4">
              <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
                Control plane
              </Text>
              <View className="mt-4 flex-row flex-wrap gap-2">
                <StatusPill label="Host" value={config ? "Linked" : "Offline"} tone={config ? "good" : "warn"} />
                <StatusPill
                  label="GitHub"
                  value={getGitHubStatusLabel(bootstrap, "Not linked")}
                  tone={bootstrap?.github?.connected ? "good" : "warn"}
                />
                <StatusPill label="Workspace" value={getCurrentProjectLabel(bootstrap, "Unavailable")} />
              </View>
              <Pressable
                disabled={!config}
                onPress={() => void refreshBootstrap().catch(() => null)}
                className="mt-4 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3"
              >
                <RefreshCw size={16} color={palette.ink} strokeWidth={2.1} />
                <Text className="text-center font-semibold text-ink">Refresh host state</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  )
}
