import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { useMemo } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Slash } from "lucide-react-native"
import { SheetShell, useSheetScrollProps } from "@/components/ui/SheetShell"
import { TextField } from "@/components/ui/TextField"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { caps, type as typeStyle } from "@/lib/typography"

export type CommandPaletteItem = {
  id: string
  title: string
  description?: string
  section: string
  badge?: string
  keywords?: string[]
  disabled?: boolean
  onPress(): void
}

type CommandPaletteSheetProps = {
  visible: boolean
  loading?: boolean
  query: string
  onQueryChange(value: string): void
  onClose(): void
  items: CommandPaletteItem[]
}

export function CommandPaletteSheet(props: CommandPaletteSheetProps) {
  const { height: windowHeight } = useWindowDimensions()

  return (
    <SheetShell
      visible={props.visible}
      onClose={props.onClose}
      avoidKeyboard
      height={Math.round(windowHeight * 0.82)}
      accessibilityLabel="Commands"
    >
      <CommandPaletteBody {...props} />
    </SheetShell>
  )
}

function CommandPaletteBody(props: CommandPaletteSheetProps) {
  const { palette, isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const sheetScroll = useSheetScrollProps()

  const sections = useMemo(() => {
    const grouped = new Map<string, CommandPaletteItem[]>()
    for (const item of props.items) {
      const current = grouped.get(item.section) ?? []
      current.push(item)
      grouped.set(item.section, current)
    }
    return [...grouped.entries()]
  }, [props.items])

  return (
    <View style={{ flex: 1 }}>
        <View className="border-b border-border px-5 pb-4">
          <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>Commands</Text>
          <Text className="mt-1.5" style={{ color: palette.ink, ...typeStyle(18, { weight: "700" }) }}>
            Session command palette
          </Text>
          <Text className="mt-1" style={{ color: palette.muted, ...typeStyle(13) }}>
            Search host commands and mobile quick actions, then prefill or trigger them from one place.
          </Text>
        </View>

        <View className="px-5 pt-3 pb-2">
          <TextField
            value={props.query}
            onChangeText={props.onQueryChange}
            placeholder="Search commands, actions, slash names"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
          />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
          {...sheetScroll}
        >
          {props.loading ? (
            <Text style={{ paddingHorizontal: 20, paddingTop: 20, color: palette.muted, ...typeStyle(14) }}>
              Loading host commands…
            </Text>
          ) : sections.length ? (
            sections.map(([section, items]) => (
              <View key={section} style={{ paddingTop: 10 }}>
                <Text
                  style={{
                    paddingHorizontal: 20,
                    paddingBottom: 4,
                    color: palette.accentLight,
                    ...caps(11, { weight: "700" }),
                  }}
                >
                  {section}
                </Text>
                {items.map((item, index) => (
                  <CommandRow
                    key={item.id}
                    item={item}
                    bordered={index < items.length - 1}
                    onPress={() => {
                      if (item.disabled) return
                      void triggerHaptic("selection")
                      item.onPress()
                    }}
                  />
                ))}
              </View>
            ))
          ) : (
            <View style={{ alignItems: "center", paddingHorizontal: 32, paddingTop: 36 }}>
              <Slash size={18} color={palette.muted} strokeWidth={2.1} />
              <Text style={{ marginTop: 10, color: palette.ink, ...typeStyle(15, { weight: "600" }) }}>
                No commands found
              </Text>
              <Text style={{ marginTop: 4, textAlign: "center", color: palette.muted, ...typeStyle(13) }}>
                Try another keyword or start a slash command in the composer.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    )
}

function CommandRow({
  item,
  bordered,
  onPress,
}: {
  item: CommandPaletteItem
  bordered: boolean
  onPress(): void
}) {
  const { palette, isDark } = useAppTheme()

  return (
    <Pressable
      onPress={onPress}
      disabled={item.disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(item.disabled) }}
      accessibilityLabel={item.badge ? `${item.title}, ${item.badge}` : item.title}
      accessibilityHint={item.description}
      style={({ pressed }) => ({
        opacity: item.disabled ? 0.48 : pressed ? 0.72 : 1,
      })}
    >
      <View
        style={{
          width: "100%",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 72,
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : hexToRgba(palette.ink, 0.08),
        }}
      >
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <Text
            style={{
              color: palette.ink,
              fontSize: 15,
              fontWeight: "600",
              letterSpacing: -0.2,
            }}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          {item.description ? (
            <Text
              style={{
                marginTop: 3,
                color: palette.soft,
                fontSize: 12.5,
                lineHeight: 17,
              }}
              numberOfLines={2}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
        {item.badge ? (
          <View
            style={{
              flexShrink: 0,
              borderRadius: 999,
              borderCurve: "continuous",
              backgroundColor: hexToRgba(palette.ink, isDark ? 0.08 : 0.06),
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text style={{ color: palette.accentLight, ...caps(10, { weight: "700" }) }}>{item.badge}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}
