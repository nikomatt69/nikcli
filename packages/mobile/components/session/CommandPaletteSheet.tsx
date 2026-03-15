import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native"
import { useMemo } from "react"
import { Search, Slash, Sparkles } from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"

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
  const { colorScheme, palette, isDark } = useAppTheme()
  const { height } = useWindowDimensions()

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
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={props.onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ backgroundColor: isDark ? "rgba(2, 6, 23, 0.58)" : "rgba(15, 23, 42, 0.18)" }}
      >
        <Pressable className="flex-1" onPress={props.onClose} />
        <View className="px-4 pb-6">
          <View className="overflow-hidden rounded-[30px] border border-border bg-surface px-4 py-4">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1 gap-1.5">
                <View className="flex-row items-center gap-2">
                  <Sparkles size={15} color={palette.accentLight} strokeWidth={2.1} />
                  <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
                    Commands
                  </Text>
                </View>
                <Text className="text-lg font-semibold text-ink">Session command palette</Text>
                <Text className="text-sm leading-5 text-soft">
                  Search host commands and mobile quick actions, then prefill or trigger them from one place.
                </Text>
              </View>

              <Pressable
                onPress={props.onClose}
                className="rounded-[16px] border border-border bg-background/75 px-3 py-2"
              >
                <Text className="text-[11px] font-semibold uppercase tracking-[1.4px] text-soft">Close</Text>
              </Pressable>
            </View>

            <View className="mt-4 flex-row items-center gap-3 rounded-[20px] border border-border bg-background/80 px-3 py-2.5">
              <Search size={16} color={palette.muted} strokeWidth={2.1} />
              <TextInput
                value={props.query}
                onChangeText={props.onQueryChange}
                placeholder="Search commands, actions, slash names"
                placeholderTextColor={palette.muted}
                selectionColor={palette.accent}
                keyboardAppearance={colorScheme === "light" ? "light" : "dark"}
                autoCapitalize="none"
                className="flex-1 text-[15px] text-ink"
              />
            </View>

            <ScrollView
              className="mt-4"
              style={{ maxHeight: Math.min(480, height * 0.6) }}
              showsVerticalScrollIndicator={false}
            >
              {props.loading ? (
                <View className="items-center rounded-[22px] border border-border bg-background/60 px-4 py-5">
                  <Text className="text-sm text-soft">Loading host commands…</Text>
                </View>
              ) : sections.length ? (
                <View className="gap-4">
                  {sections.map(([section, items]) => (
                    <View key={section} className="gap-2">
                      <Text className="text-[10px] font-semibold uppercase tracking-[1.6px] text-accent-light">
                        {section}
                      </Text>
                      {items.map((item) => (
                        <Pressable
                          key={item.id}
                          disabled={item.disabled}
                          onPress={item.onPress}
                          className={`rounded-[20px] border px-3 py-3 ${item.disabled ? "border-border/70 bg-background/55 opacity-60" : "border-border bg-background/70"}`}
                        >
                          <View className="flex-row items-start justify-between gap-3">
                            <View className="min-w-0 flex-1 gap-1">
                              <Text className="text-sm font-semibold text-ink">{item.title}</Text>
                              {item.description ? (
                                <Text className="text-xs leading-5 text-soft" numberOfLines={2}>
                                  {item.description}
                                </Text>
                              ) : null}
                            </View>
                            {item.badge ? (
                              <View className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1">
                                <Text className="text-[10px] font-semibold uppercase tracking-[1.3px] text-accent-light">
                                  {item.badge}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>
              ) : (
                <View className="items-center rounded-[22px] border border-border bg-background/60 px-4 py-5">
                  <Slash size={16} color={palette.muted} strokeWidth={2.1} />
                  <Text className="mt-2 text-sm font-semibold text-ink">No commands found</Text>
                  <Text className="mt-1 text-center text-xs leading-5 text-soft">
                    Try another keyword or start a slash command directly in the composer.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
