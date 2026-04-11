import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native"
import { ChevronRight, Globe, Plug, Search, Server, Sparkles, Terminal, X, Zap } from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window")

export type PluginCategory = "mcp" | "skill" | "tool" | "connector"

export type PluginInfo = {
  id: string
  name: string
  description?: string
  category: PluginCategory
  icon?: string
  enabled: boolean
  connected?: boolean
  source?: string
  author?: string
  version?: string
  installCount?: number
  rating?: number
}

export type PluginManagerSheetProps = {
  visible: boolean
  onClose(): void
  plugins?: PluginInfo[]
  onPluginToggle?(id: string, enabled: boolean): void
  onPluginInstall?(id: string): void
  onPluginUninstall?(id: string): void
  onManageMcp?(): void
  onManageSkills?(): void
  onManageConnectors?(): void
  loading?: boolean
  searchQuery?: string
  onSearchChange?(query: string): void
}

const CATEGORY_ICONS: Record<PluginCategory, typeof Server> = {
  mcp: Server,
  skill: Sparkles,
  tool: Terminal,
  connector: Plug,
}

const CATEGORY_LABELS: Record<PluginCategory, string> = {
  mcp: "MCP Servers",
  skill: "Skills",
  tool: "Tools",
  connector: "Connectors",
}

export function PluginManagerSheet({
  visible,
  onClose,
  plugins = [],
  onPluginToggle,
  onPluginInstall,
  onPluginUninstall,
  onManageMcp,
  onManageSkills,
  onManageConnectors,
  loading = false,
  searchQuery = "",
  onSearchChange,
}: PluginManagerSheetProps) {
  const { palette, isDark } = useAppTheme()
  const slideAnim = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const contentScaleAnim = useRef(new Animated.Value(0.94)).current
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory | "all">("all")

  const categories: Array<PluginCategory | "all"> = ["all", "mcp", "skill", "tool", "connector"]

  const filteredPlugins = useMemo(() => {
    let result = plugins
    if (selectedCategory !== "all") {
      result = result.filter((p) => p.category === selectedCategory)
    }
    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase()
      result = result.filter((p) => p.name.toLowerCase().includes(term) || p.description?.toLowerCase().includes(term))
    }
    return result
  }, [plugins, selectedCategory, searchQuery])

  const connectedCount = plugins.filter((p) => p.connected).length
  const enabledCount = plugins.filter((p) => p.enabled).length

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacityAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 1, damping: 20, stiffness: 260, mass: 0.8, useNativeDriver: true }),
        Animated.spring(contentScaleAnim, {
          toValue: 1,
          damping: 22,
          stiffness: 300,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(opacityAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(contentScaleAnim, { toValue: 0.94, duration: 160, useNativeDriver: true }),
      ]).start(() => onClose())
    }
  }, [visible, opacityAnim, slideAnim, contentScaleAnim, onClose])

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_HEIGHT * 0.7, 0] })

  const manageActions: Array<{ category: PluginCategory; onPress?: () => void }> = [
    { category: "mcp", onPress: onManageMcp },
    { category: "skill", onPress: onManageSkills },
    { category: "connector", onPress: onManageConnectors },
  ]

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacityAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            <View style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(15,23,42,0.20)" }} />
          </Pressable>
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={{
            transform: [{ translateY }, { scale: contentScaleAnim }],
            backgroundColor: isDark ? "rgba(17,17,17,0.95)" : "rgba(255,255,255,0.95)",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            shadowColor: "#000",
            shadowOpacity: isDark ? 0.5 : 0.2,
            shadowRadius: 28,
            shadowOffset: { width: 0, height: -8 },
            maxHeight: SCREEN_HEIGHT * 0.85,
          }}
        >
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 85 : 70}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
          />

          {/* Drag handle */}
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 8 }}>
            <View
              style={{
                width: 42,
                height: 5,
                borderRadius: 999,
                backgroundColor: isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.16)",
              }}
            />
          </View>

          {/* Header */}
          <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View
                  style={[
                    styles.headerIcon,
                    { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.09)" },
                  ]}
                >
                  <Plug size={18} color={palette.accentLight} strokeWidth={2} />
                </View>
                <Text style={{ fontSize: 18, fontWeight: "700", color: palette.ink, letterSpacing: -0.3 }}>
                  Plugins
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <X size={16} color={palette.muted} strokeWidth={2} />
              </Pressable>
            </View>

            {/* Stats */}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <View
                style={[
                  styles.statPill,
                  { backgroundColor: "rgba(52,199,89,0.10)", borderColor: "rgba(52,199,89,0.22)" },
                ]}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#34C759" }}>{connectedCount} connected</Text>
              </View>
              <View
                style={[
                  styles.statPill,
                  {
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.08)",
                    borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(14,165,233,0.16)",
                  },
                ]}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: palette.accentLight }}>
                  {enabledCount} enabled
                </Text>
              </View>
            </View>
          </View>

          {/* Search */}
          {onSearchChange && (
            <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
              <View
                style={[
                  styles.searchBar,
                  {
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    borderColor: palette.border,
                  },
                ]}
              >
                <Search size={14} color={palette.muted} strokeWidth={2} />
                <TextInput
                  value={searchQuery}
                  onChangeText={onSearchChange}
                  placeholder="Search plugins..."
                  placeholderTextColor={palette.muted}
                  style={{ flex: 1, fontSize: 14, color: palette.ink }}
                />
              </View>
            </View>
          )}

          {/* Category tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 8, marginBottom: 12 }}
          >
            {categories.map((cat) => {
              const isActive = selectedCategory === cat
              const Icon = cat === "all" ? Zap : CATEGORY_ICONS[cat]
              return (
                <AnimatedCategoryTab
                  key={cat}
                  isActive={isActive}
                  onPress={() => {
                    void triggerHaptic("selection")
                    setSelectedCategory(cat)
                  }}
                  palette={palette}
                  isDark={isDark}
                >
                  <Icon size={12} color={isActive ? "#fff" : palette.muted} strokeWidth={2} />
                  <Text style={[styles.categoryTabLabel, { color: isActive ? "#fff" : palette.muted }]}>
                    {cat === "all" ? "All" : CATEGORY_LABELS[cat]}
                  </Text>
                </AnimatedCategoryTab>
              )
            })}
          </ScrollView>

          {/* Manage shortcuts */}
          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <View style={[styles.manageSection, { borderColor: palette.border }]}>
              <Text style={[styles.manageSectionLabel, { color: palette.muted }]}>Manage</Text>
              <View style={{ gap: 8 }}>
                {manageActions.map(({ category, onPress }) => {
                  const Icon = CATEGORY_ICONS[category]
                  return (
                    <AnimatedManageCard
                      key={category}
                      onPress={() => {
                        void triggerHaptic("selection")
                        onPress?.()
                      }}
                      isDark={isDark}
                      palette={palette}
                    >
                      <View
                        style={[
                          styles.manageIcon,
                          { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.08)" },
                        ]}
                      >
                        <Icon size={16} color={palette.accentLight} strokeWidth={2} />
                      </View>
                      <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: palette.ink }}>
                        {CATEGORY_LABELS[category]}
                      </Text>
                      <ChevronRight size={14} color={palette.muted} strokeWidth={2} />
                    </AnimatedManageCard>
                  )
                })}
              </View>
            </View>
          </View>

          {/* Plugin list */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 36 }}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <ActivityIndicator size="small" color={palette.accent} />
                <Text style={{ marginTop: 12, fontSize: 13, color: palette.muted }}>Loading plugins...</Text>
              </View>
            ) : filteredPlugins.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Text style={[styles.pluginListLabel, { color: palette.muted }]}>
                  {selectedCategory === "all" ? "All Plugins" : CATEGORY_LABELS[selectedCategory as PluginCategory]}
                </Text>
                {filteredPlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onToggle={(enabled) => {
                      void triggerHaptic("selection")
                      onPluginToggle?.(plugin.id, enabled)
                    }}
                    onInstall={() => {
                      void triggerHaptic("selection")
                      onPluginInstall?.(plugin.id)
                    }}
                    onUninstall={() => {
                      void triggerHaptic("error")
                      onPluginUninstall?.(plugin.id)
                    }}
                  />
                ))}
              </View>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 20 }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Plug size={24} color={palette.muted} strokeWidth={1.5} />
                </View>
                <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink, marginBottom: 4 }}>
                  {searchQuery ? "No matching plugins" : "No plugins available"}
                </Text>
                <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center" }}>
                  {searchQuery ? "Try a different search term" : "Plugins will appear here when installed"}
                </Text>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  )
}

function AnimatedCategoryTab({
  children,
  isActive,
  onPress,
  palette,
  isDark,
}: {
  children: React.ReactNode
  isActive: boolean
  onPress: () => void
  palette: { accent: string; muted: string }
  isDark: boolean
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current
  const glowAnim = useRef(new Animated.Value(isActive ? 1 : 0)).current

  useEffect(() => {
    Animated.spring(glowAnim, {
      toValue: isActive ? 1 : 0,
      damping: 22,
      stiffness: 260,
      mass: 0.7,
      useNativeDriver: false,
    }).start()
  }, [isActive, glowAnim])

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.94,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["transparent", palette.accent],
  })

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={[
          styles.categoryTab,
          {
            transform: [{ scale: scaleAnim }],
            borderColor,
            borderWidth: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1.5] }),
            backgroundColor: isActive ? palette.accent : isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.08)",
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}

function AnimatedManageCard({
  children,
  onPress,
  isDark,
  palette,
}: {
  children: React.ReactNode
  onPress: () => void
  isDark: boolean
  palette: { ink: string; accentLight: string; muted: string }
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={{
          transform: [{ scale: scaleAnim }],
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 12,
          borderRadius: 14,
          backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(14,165,233,0.04)",
        }}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}

function PluginCard({
  plugin,
  onToggle,
  onInstall,
  onUninstall,
}: {
  plugin: PluginInfo
  onToggle(enabled: boolean): void
  onInstall(): void
  onUninstall(): void
}) {
  const { palette, isDark } = useAppTheme()
  const Icon = CATEGORY_ICONS[plugin.category] ?? Plug
  const [expanded, setExpanded] = useState(false)

  return (
    <View
      style={[
        styles.pluginCard,
        { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.90)", borderColor: palette.border },
      ]}
    >
      <Pressable
        onPress={() => {
          void triggerHaptic("selection")
          setExpanded((v) => !v)
        }}
        style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <View
          style={[styles.pluginIcon, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.08)" }]}
        >
          <Icon size={16} color={palette.accentLight} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }} numberOfLines={1}>
            {plugin.name}
          </Text>
          {plugin.description && (
            <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }} numberOfLines={1}>
              {plugin.description}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {plugin.connected !== undefined && (
            <View style={[styles.statusDot, { backgroundColor: plugin.connected ? "#34C759" : palette.muted }]} />
          )}
          <Switch
            value={plugin.enabled}
            onValueChange={onToggle}
            trackColor={{ false: palette.border, true: palette.accent }}
            thumbColor="#fff"
          />
        </View>
      </Pressable>

      {expanded && (
        <View style={[styles.pluginExpanded, { borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12 }]}>
          {plugin.source && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Globe size={10} color={palette.muted} strokeWidth={2} />
              <Text style={{ fontSize: 11, color: palette.muted }} numberOfLines={1}>
                {plugin.source}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={onUninstall}
              style={({ pressed }) => [
                styles.pluginAction,
                {
                  backgroundColor: "rgba(255,59,48,0.10)",
                  borderColor: "rgba(255,59,48,0.22)",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: "#FF3B30" }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  categoryTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  categoryTabLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  manageSection: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  manageSectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  manageIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pluginListLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  pluginCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  pluginIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pluginExpanded: {
    paddingTop: 12,
  },
  pluginAction: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
})
