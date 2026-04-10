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
import {
  ArrowDown,
  BookMarked,
  Brain,
  Clock,
  Cpu,
  Eye,
  GitBranch,
  Puzzle,
  Search,
  Slash,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"

export type CommandPaletteItem = {
  id: string
  title: string
  description?: string
  section: string
  badge?: string
  keywords?: string[]
  disabled?: boolean
  icon?: LucideIcon
  shortcut?: string
  onPress(): void
}

type CommandPaletteSheetProps = {
  visible: boolean
  loading?: boolean
  query: string
  onQueryChange(value: string): void
  onClose(): void
  items: CommandPaletteItem[]
  recentItemIDs?: string[]
}

const SECTION_ICONS: Record<string, LucideIcon> = {
  View: Eye,
  Session: Cpu,
  GitHub: GitBranch,
  MCP: Puzzle,
  Skills: Sparkles,
  Commands: Terminal,
  Presets: BookMarked,
  Memories: Brain,
  Compose: Terminal,
  Recent: Clock,
}

export function CommandPaletteSheet(props: CommandPaletteSheetProps) {
  const { colorScheme, palette, isDark } = useAppTheme()
  const { height } = useWindowDimensions()

  const sections = useMemo(() => {
    const grouped = new Map<string, CommandPaletteItem[]>()

    // Prepend "Recent" section when query is empty and recent IDs exist
    if (!props.query.trim() && props.recentItemIDs?.length) {
      const recentItems = props.recentItemIDs
        .map((id) => props.items.find((item) => item.id === id))
        .filter((item): item is CommandPaletteItem => Boolean(item))
      if (recentItems.length) grouped.set("Recent", recentItems)
    }

    for (const item of props.items) {
      // Skip items already shown in Recent
      const inRecent =
        !props.query.trim() &&
        props.recentItemIDs?.includes(item.id) &&
        grouped.has("Recent")
      if (inRecent) continue

      const current = grouped.get(item.section) ?? []
      current.push(item)
      grouped.set(item.section, current)
    }
    return [...grouped.entries()]
  }, [props.items, props.query, props.recentItemIDs])

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
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(15,23,42,0.16)" }]}
        />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={{ flex: 1 }} onPress={props.onClose} />

          <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            {/* Glass card */}
            <View style={styles.card}>
              <AdaptiveBlur
                tint={isDark ? "dark" : "light"}
                intensity={isDark ? 92 : 80}
                style={StyleSheet.absoluteFill}
                fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              />
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(17,17,17,0.68)" : "rgba(255,255,255,0.62)" }]}
                pointerEvents="none"
              />

              <View style={{ padding: 16 }}>
                {/* Header */}
                <View style={styles.headerRow}>
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Sparkles size={15} color={palette.accentLight} strokeWidth={2.1} />
                      <Text style={[styles.eyebrow, { color: palette.accentLight }]}>Commands</Text>
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: "600", color: palette.ink }}>
                      Session command palette
                    </Text>
                    <Text style={{ fontSize: 14, lineHeight: 20, color: palette.soft }}>
                      Search host commands and mobile quick actions.
                    </Text>
                  </View>

                  <Pressable
                    onPress={props.onClose}
                    style={[styles.closeBtn, { borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.80)", backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)" }]}
                  >
                    <Text style={[styles.closeBtnText, { color: palette.soft }]}>Close</Text>
                  </Pressable>
                </View>

                {/* Search field */}
                <View
                  style={[
                    styles.searchBar,
                    {
                      borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.80)",
                      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.55)",
                    },
                  ]}
                >
                  <Search size={16} color={palette.muted} strokeWidth={2.1} />
                  <TextInput
                    value={props.query}
                    onChangeText={props.onQueryChange}
                    placeholder="Search commands, actions, slash names…"
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
                    <View style={[styles.emptyCard, { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)", backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.45)" }]}>
                      <Text style={{ fontSize: 14, color: palette.soft }}>Loading host commands…</Text>
                    </View>
                  ) : sections.length ? (
                    <View style={{ gap: 16 }}>
                      {sections.map(([section, items]) => {
                        const SectionIcon = SECTION_ICONS[section] ?? ArrowDown
                        return (
                          <View key={section} style={{ gap: 8 }}>
                            {/* Section header with icon */}
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <SectionIcon size={10} color={palette.accentLight} strokeWidth={2.2} />
                              <Text style={[styles.sectionLabel, { color: palette.accentLight }]}>
                                {section}
                              </Text>
                            </View>

                            {items.map((item) => (
                              <Pressable
                                key={item.id}
                                disabled={item.disabled}
                                onPress={item.onPress}
                                style={({ pressed }) => [
                                  styles.itemCard,
                                  {
                                    borderColor: item.disabled
                                      ? isDark ? "rgba(255,255,255,0.06)" : "rgba(193,208,223,0.6)"
                                      : isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.78)",
                                    backgroundColor: item.disabled
                                      ? isDark ? "rgba(255,255,255,0.02)" : "rgba(241,246,251,0.45)"
                                      : pressed
                                        ? isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.80)"
                                        : isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.52)",
                                    opacity: item.disabled ? 0.6 : 1,
                                  },
                                ]}
                              >
                                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                                  {/* Optional item icon */}
                                  {item.icon ? (
                                    <View style={[styles.itemIcon, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(14,165,233,0.07)", borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(14,165,233,0.14)" }]}>
                                      <item.icon size={14} color={palette.accentLight} strokeWidth={2} />
                                    </View>
                                  ) : null}

                                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink, flex: 1 }} numberOfLines={1}>
                                        {item.title}
                                      </Text>
                                      {/* Keyboard shortcut badge */}
                                      {item.shortcut ? (
                                        <View style={[styles.shortcutBadge, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)" }]}>
                                          <Text style={{ fontSize: 10, fontWeight: "600", color: palette.muted }}>{item.shortcut}</Text>
                                        </View>
                                      ) : null}
                                      {/* Badge */}
                                      {item.badge && !item.shortcut ? (
                                        <View style={[styles.badge, { borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.18)", backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.08)" }]}>
                                          <Text style={[styles.badgeText, { color: palette.accentLight }]}>{item.badge}</Text>
                                        </View>
                                      ) : null}
                                    </View>
                                    {item.description ? (
                                      <Text style={{ fontSize: 12, lineHeight: 18, color: palette.soft }} numberOfLines={2}>
                                        {item.description}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                              </Pressable>
                            ))}
                          </View>
                        )
                      })}
                    </View>
                  ) : (
                    <View style={[styles.emptyCard, { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)", backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.45)" }]}>
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

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  closeBtn: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeBtnText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  searchBar: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  itemCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
  },
  itemIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  shortcutBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  emptyCard: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
})
