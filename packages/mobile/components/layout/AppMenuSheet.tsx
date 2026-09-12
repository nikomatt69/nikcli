import { useState, type RefObject } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { router, type Href } from "expo-router"
import { Clock, Folder, Monitor, Puzzle, Settings, SquareTerminal, type LucideIcon } from "lucide-react-native"
import { ActionSheet, ActionSheetDivider, type ActionSheetRef } from "@/components/BottomSheet"
import { usePressAnimation } from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

type AppMenuSheetProps = {
  sheetRef: RefObject<ActionSheetRef | null>
  hostLabel: string
  connected: boolean
  version?: string
  onChangeWorkspace(): void
}

const DESTINATIONS: Array<{
  href: Href
  label: string
  description: string
  Icon: LucideIcon
}> = [
  { href: "/repos", label: "Workspaces", description: "Projects on this host", Icon: Folder },
  { href: "/terminal", label: "Terminal", description: "Shell on the linked machine", Icon: SquareTerminal },
  { href: "/routines", label: "Routines", description: "Scheduled prompts", Icon: Clock },
  { href: "/more", label: "Tools", description: "Missions, loops, appearance", Icon: Puzzle },
  { href: "/more/settings", label: "Settings", description: "Host, models, and account", Icon: Settings },
]

function MenuRow({
  Icon,
  label,
  description,
  onPress,
}: {
  Icon: LucideIcon
  label: string
  description?: string
  onPress(): void
}) {
  const { palette } = useAppTheme()
  const [pressed, setPressed] = useState(false)
  const press = usePressAnimation()

  return (
    <Animated.View style={{ alignSelf: "stretch", transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={description}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true)
          press.onPressIn()
        }}
        onPressOut={() => {
          setPressed(false)
          press.onPressOut()
        }}
        style={{ alignSelf: "stretch" }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "stretch",
            gap: 14,
            minHeight: 64,
            paddingHorizontal: 20,
            paddingVertical: 10,
            opacity: pressed ? 0.72 : 1,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              backgroundColor: hexToRgba(palette.ink, 0.06),
              borderWidth: 1,
              borderColor: hexToRgba(palette.ink, 0.12),
            }}
          >
            <Icon size={18} color={palette.ink} strokeWidth={2} />
          </View>
          <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: palette.ink, ...typeStyle(16, { weight: "600" }) }}>
              {label}
            </Text>
            {description ? (
              <Text numberOfLines={1} style={{ color: palette.muted, marginTop: 2, ...typeStyle(13) }}>
                {description}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

/**
 * Destinations the sessions home used to reach via the tab bar. The hamburger
 * is how you leave the Code screen.
 */
export function AppMenuSheet({ sheetRef, hostLabel, connected, version, onChangeWorkspace }: AppMenuSheetProps) {
  const { palette } = useAppTheme()
  const detail = connected ? [version ? `v${version}` : null, "Connected"].filter(Boolean).join(" · ") : "Disconnected"

  return (
    <ActionSheet ref={sheetRef} snapPoints={[640]}>
      <View style={{ alignSelf: "stretch", width: "100%", paddingBottom: 28 }}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
          <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>This host</Text>
          <Text style={{ color: palette.ink, marginTop: 4, ...typeStyle(17, { weight: "700" }) }} numberOfLines={1}>
            {hostLabel}
          </Text>
          <Text style={{ color: palette.muted, marginTop: 2, ...typeStyle(13) }}>{detail}</Text>
        </View>

        <MenuRow
          Icon={Monitor}
          label="Change workspace"
          description="Switch the directory this app talks to"
          onPress={() => {
            void triggerHaptic("selection")
            sheetRef.current?.dismiss(onChangeWorkspace)
          }}
        />

        <ActionSheetDivider />

        {DESTINATIONS.map((item) => (
          <MenuRow
            key={item.label}
            Icon={item.Icon}
            label={item.label}
            description={item.description}
            onPress={() => {
              void triggerHaptic("selection")
              sheetRef.current?.dismiss(() => router.push(item.href))
            }}
          />
        ))}
      </View>
    </ActionSheet>
  )
}
