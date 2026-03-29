import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native"
import { useMemo } from "react"
import { AdaptiveBlur } from "@/components/GlassView"
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
      <View style={{ flex: 1 }}>
        {/* Full-screen blur backdrop */}
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 20 : 14}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.20)"}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(15,23,42,0.16)" },
          ]}
        />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={{ flex: 1 }} onPress={props.onClose} />

          <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            {/* Glass card */}
            <View
              style={{
                overflow: "hidden",
                borderRadius: 30,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.82)",
                shadowColor: "#000",
                shadowOpacity: isDark ? 0.45 : 0.14,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: 8 },
                elevation: 20,
              }}
            >
              <AdaptiveBlur
                tint={isDark ? "dark" : "light"}
                intensity={isDark ? 92 : 80}
                style={StyleSheet.absoluteFill}
                fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: isDark ? "rgba(17,17,17,0.68)" : "rgba(255,255,255,0.62)" },
                ]}
                pointerEvents="none"
              />

              <View style={{ padding: 16 }}>
                {/* Header */}
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Sparkles size={15} color={palette.accentLight} strokeWidth={2.1} />
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          letterSpacing: 1.8,
                          textTransform: "uppercase",
                          color: palette.accentLight,
                        }}
                      >
                        Commands
                      </Text>
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: "600", color: palette.ink }}>
                      Session command palette
                    </Text>
                    <Text style={{ fontSize: 14, lineHeight: 20, color: palette.soft }}>
                      Search host commands and mobile quick actions, then prefill or trigger them from one place.
                    </Text>
                  </View>

                  <Pressable
                    onPress={props.onClose}
                    style={{
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.80)",
                      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)",
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        color: palette.soft,
                      }}
                    >
                      Close
                    </Text>
                  </Pressable>
                </View>

                {/* Search field */}
                <View
                  style={{
                    marginTop: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.80)",
                    backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.55)",
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                >
                  <Search size={16} color={palette.muted} strokeWidth={2.1} />
                  <TextInput
                    value={props.query}
                    onChangeText={props.onQueryChange}
                    placeholder="Search commands, actions, slash names"
                    placeholderTextColor={palette.muted}
                    selectionColor={palette.accent}
                    keyboardAppearance={colorScheme === "light" ? "light" : "dark"}
                    autoCapitalize="none"
                    autoFocus
                    style={{ flex: 1, fontSize: 15, color: palette.ink }}
                  />
                </View>

                {/* Results */}
                <ScrollView
                  style={{ marginTop: 16, maxHeight: Math.min(480, height * 0.6) }}
                  showsVerticalScrollIndicator={false}
                >
                  {props.loading ? (
                    <View
                      style={{
                        alignItems: "center",
                        borderRadius: 22,
                        borderWidth: 1,
                        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)",
                        backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.45)",
                        paddingHorizontal: 16,
                        paddingVertical: 20,
                      }}
                    >
                      <Text style={{ fontSize: 14, color: palette.soft }}>Loading host commands…</Text>
                    </View>
                  ) : sections.length ? (
                    <View style={{ gap: 16 }}>
                      {sections.map(([section, items]) => (
                        <View key={section} style={{ gap: 8 }}>
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "700",
                              letterSpacing: 1.6,
                              textTransform: "uppercase",
                              color: palette.accentLight,
                            }}
                          >
                            {section}
                          </Text>
                          {items.map((item) => (
                            <Pressable
                              key={item.id}
                              disabled={item.disabled}
                              onPress={item.onPress}
                              style={{
                                borderRadius: 20,
                                borderWidth: 1,
                                borderColor: item.disabled
                                  ? isDark
                                    ? "rgba(255,255,255,0.06)"
                                    : "rgba(193,208,223,0.6)"
                                  : isDark
                                    ? "rgba(255,255,255,0.08)"
                                    : "rgba(255,255,255,0.78)",
                                backgroundColor: item.disabled
                                  ? isDark
                                    ? "rgba(255,255,255,0.02)"
                                    : "rgba(241,246,251,0.45)"
                                  : isDark
                                    ? "rgba(255,255,255,0.04)"
                                    : "rgba(255,255,255,0.52)",
                                padding: 12,
                                opacity: item.disabled ? 0.6 : 1,
                              }}
                            >
                              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                                  <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>
                                    {item.title}
                                  </Text>
                                  {item.description ? (
                                    <Text style={{ fontSize: 12, lineHeight: 20, color: palette.soft }} numberOfLines={2}>
                                      {item.description}
                                    </Text>
                                  ) : null}
                                </View>
                                {item.badge ? (
                                  <View
                                    style={{
                                      borderRadius: 999,
                                      borderWidth: 1,
                                      borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.18)",
                                      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.08)",
                                      paddingHorizontal: 10,
                                      paddingVertical: 4,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 10,
                                        fontWeight: "700",
                                        letterSpacing: 1.3,
                                        textTransform: "uppercase",
                                        color: palette.accentLight,
                                      }}
                                    >
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
                    <View
                      style={{
                        alignItems: "center",
                        borderRadius: 22,
                        borderWidth: 1,
                        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)",
                        backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.45)",
                        paddingHorizontal: 16,
                        paddingVertical: 20,
                      }}
                    >
                      <Slash size={16} color={palette.muted} strokeWidth={2.1} />
                      <Text style={{ marginTop: 8, fontSize: 14, fontWeight: "600", color: palette.ink }}>
                        No commands found
                      </Text>
                      <Text style={{ marginTop: 4, textAlign: "center", fontSize: 12, lineHeight: 20, color: palette.soft }}>
                        Try another keyword or start a slash command directly in the composer.
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
