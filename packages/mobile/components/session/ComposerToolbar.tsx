import { useCallback, useEffect, useRef, useState } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import {
  Brain,
  ChevronRight,
  Code2,
  GitBranch,
  MapPin,
  Paperclip,
  Plus,
  Puzzle,
  Search,
  Server,
  Sparkles,
  Terminal,
  Wifi,
  X,
} from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")

export type ComposerToolbarTab = "attach" | "tools" | "skills" | "mcp" | "model" | "none"

export type ComposerToolbarProps = {
  onAttach?(): void
  onGitPress?(): void
  onModelSelect?(id: string): void
  onMcpToggle?(name: string, enabled: boolean): void
  onSkillSelect?(name: string): void
  onToolSelect?(name: string): void
  modelLabel?: string
  availableModels?: Array<{ id: string; name: string; badge?: string }>
  mcpServers?: Array<{ name: string; connected: boolean; enabled: boolean }>
  skills?: Array<{ name: string; description?: string }>
  tools?: Array<{ name: string; description?: string; enabled?: boolean }>
}

type TabConfig = {
  id: ComposerToolbarTab
  icon: typeof Plus
  label: string
}

const TABS: TabConfig[] = [
  { id: "attach", icon: Plus, label: "Attach" },
  { id: "tools", icon: Terminal, label: "Tools" },
  { id: "skills", icon: Sparkles, label: "Skills" },
  { id: "mcp", icon: Puzzle, label: "MCP" },
  { id: "model", icon: Code2, label: "Model" },
]

export function ComposerToolbar({
  onAttach,
  onGitPress,
  onModelSelect,
  onMcpToggle,
  onSkillSelect,
  onToolSelect,
  modelLabel,
  availableModels = [],
  mcpServers = [],
  skills = [],
  tools = [],
}: ComposerToolbarProps) {
  const { palette, isDark } = useAppTheme()
  const [activeTab, setActiveTab] = useState<ComposerToolbarTab>("attach")
  const [drawerVisible, setDrawerVisible] = useState(false)

  const openTab = useCallback((tab: ComposerToolbarTab) => {
    void triggerHaptic("selection")
    setActiveTab(tab)
    setDrawerVisible(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerVisible(false)
  }, [])

  const handleGitPress = useCallback(() => {
    void triggerHaptic("selection")
    onGitPress?.()
  }, [onGitPress])

  return (
    <ComposerDrawer
      visible={drawerVisible}
      activeTab={activeTab}
      onClose={closeDrawer}
      onTabChange={setActiveTab}
      modelLabel={modelLabel}
      availableModels={availableModels}
      onModelSelect={onModelSelect}
      mcpServers={mcpServers}
      onMcpToggle={onMcpToggle}
      skills={skills}
      onSkillSelect={onSkillSelect}
      tools={tools}
      onToolSelect={onToolSelect}
    />
  )
}

type ComposerDrawerProps = {
  visible: boolean
  activeTab: ComposerToolbarTab
  onClose(): void
  onTabChange(tab: ComposerToolbarTab): void
  modelLabel?: string
  availableModels?: Array<{ id: string; name: string; badge?: string }>
  onModelSelect?(id: string): void
  mcpServers?: Array<{ name: string; connected: boolean; enabled: boolean }>
  onMcpToggle?(name: string, enabled: boolean): void
  skills?: Array<{ name: string; description?: string }>
  onSkillSelect?(name: string): void
  tools?: Array<{ name: string; description?: string; enabled?: boolean }>
  onToolSelect?(name: string): void
}

const TAB_TITLES: Record<ComposerToolbarTab, string> = {
  attach: "Attach",
  tools: "Tools",
  skills: "Skills",
  mcp: "MCP Servers",
  model: "Model",
  none: "",
}

function ComposerDrawer({
  visible,
  activeTab,
  onClose,
  onTabChange,
  modelLabel,
  availableModels = [],
  onModelSelect,
  mcpServers = [],
  onMcpToggle,
  skills = [],
  onSkillSelect,
  tools = [],
  onToolSelect,
}: ComposerDrawerProps) {
  const { palette, isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const slideAnim = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const contentScaleAnim = useRef(new Animated.Value(0.94)).current

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
      ]).start()
    }
  }, [visible, opacityAnim, slideAnim, contentScaleAnim])

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] })

  const tabs = TABS.filter((t) => t.id !== "attach")
  const contentHeight = SCREEN_HEIGHT * 0.72 - insets.bottom

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacityAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            <View style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(15,23,42,0.20)" }} />
          </Pressable>
        </Animated.View>

        <Animated.View
          style={{
            transform: [{ translateY }, { scale: contentScaleAnim }],
            backgroundColor: isDark ? palette.surface : palette.background,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            shadowColor: palette.shadow,
            shadowOpacity: isDark ? 0.5 : 0.14,
            shadowRadius: 28,
            shadowOffset: { width: 0, height: -8 },
            height: contentHeight,
            overflow: "hidden",
          }}
        >
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 85 : 60}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? palette.surface : palette.background}
          />

          {/* Drag handle */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
            <View
              style={{
                width: 42,
                height: 5,
                borderRadius: 999,
                backgroundColor: isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.14)",
              }}
            />
          </View>

          {/* Header — title + close button */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: palette.border,
            }}
          >
            <Text
              style={{
                flex: 1,
                fontSize: 17,
                fontWeight: "700",
                letterSpacing: -0.3,
                color: palette.ink,
              }}
            >
              {TAB_TITLES[activeTab]}
            </Text>
            <Pressable
              onPress={() => {
                void triggerHaptic("selection")
                onClose()
              }}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : palette.panel,
                borderWidth: 1,
                borderColor: palette.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <X size={15} color={palette.soft} strokeWidth={2.5} />
            </Pressable>
          </View>

          {/* Tab pills */}
          <View style={{ flexDirection: "row", paddingHorizontal: 16, gap: 8, paddingVertical: 12 }}>
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              const connectedCount = tab.id === "mcp" ? mcpServers.filter((s) => s.connected).length : 0

              return (
                <AnimatedTabButton
                  key={tab.id}
                  isActive={isActive}
                  onPress={() => {
                    void triggerHaptic("selection")
                    onTabChange(tab.id)
                  }}
                  palette={palette}
                >
                  <Icon size={14} color={isActive ? "#fff" : palette.muted} strokeWidth={2} />
                  <Text style={[styles.tabLabel, { color: isActive ? "#fff" : palette.muted }]}>{tab.label}</Text>
                  {connectedCount > 0 && (
                    <View
                      style={[
                        styles.tabBadge,
                        { backgroundColor: isActive ? "rgba(255,255,255,0.25)" : "rgba(14,165,233,0.15)" },
                      ]}
                    >
                      <Text style={[styles.tabBadgeText, { color: isActive ? "#fff" : palette.accentLight }]}>
                        {connectedCount}
                      </Text>
                    </View>
                  )}
                </AnimatedTabButton>
              )
            })}
          </View>

          {/* Content */}
          <View
            style={{
              flex: 1,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.border,
              paddingBottom: insets.bottom,
            }}
          >
            {activeTab === "model" && (
              <ModelContent
                modelLabel={modelLabel}
                availableModels={availableModels}
                onModelSelect={(id) => {
                  onModelSelect?.(id)
                  onClose()
                }}
              />
            )}
            {activeTab === "mcp" && <McpContent servers={mcpServers} onMcpToggle={onMcpToggle} />}
            {activeTab === "skills" && (
              <SkillsContent
                skills={skills}
                onSkillSelect={(name) => {
                  onSkillSelect?.(name)
                  onClose()
                }}
              />
            )}
            {activeTab === "tools" && (
              <ToolsContent
                tools={tools}
                onToolSelect={(name) => {
                  onToolSelect?.(name)
                  onClose()
                }}
              />
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

function ModelContent({
  modelLabel,
  availableModels = [],
  onModelSelect,
}: {
  modelLabel?: string
  availableModels?: Array<{ id: string; name: string; badge?: string }>
  onModelSelect?(id: string): void
}) {
  const { palette, isDark } = useAppTheme()

  return (
    <ScrollView style={{ paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
      {modelLabel && (
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <View
            style={[
              styles.currentModel,
              {
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.20)",
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.06)",
              },
            ]}
          >
            <Code2 size={16} color={palette.accentLight} strokeWidth={2} />
            <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: palette.ink }}>{modelLabel}</Text>
            <Text style={{ fontSize: 11, fontWeight: "600", color: palette.accentLight }}>Current</Text>
          </View>
        </View>
      )}

      {availableModels.map((model, i) => (
        <AnimatedListItem
          key={model.id}
          onPress={() => {
            void triggerHaptic("selection")
            onModelSelect?.(model.id)
          }}
          isDark={isDark}
          palette={palette}
          index={i}
          borderBottom={i < availableModels.length - 1}
        >
          <View
            style={[styles.modelIcon, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.07)" }]}
          >
            <MapPin size={16} color={palette.accentLight} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>{model.name}</Text>
            {model.badge && (
              <View
                style={[styles.badge, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.08)" }]}
              >
                <Text style={{ fontSize: 9, fontWeight: "700", color: palette.accentLight }}>{model.badge}</Text>
              </View>
            )}
          </View>
          <ChevronRight size={14} color={palette.muted} strokeWidth={2} />
        </AnimatedListItem>
      ))}
      {availableModels.length === 0 && !modelLabel && (
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
            <Code2 size={24} color={palette.muted} strokeWidth={1.5} />
          </View>
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink, marginBottom: 4 }}>
            No models available
          </Text>
          <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center" }}>
            Configure AI models in settings
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

function McpContent({
  servers = [],
  onMcpToggle,
}: {
  servers?: Array<{ name: string; connected: boolean; enabled: boolean }>
  onMcpToggle?(name: string, enabled: boolean): void
}) {
  const { palette, isDark } = useAppTheme()

  return (
    <ScrollView style={{ paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
      {servers.length > 0 ? (
        servers.map((server, i) => (
          <AnimatedSwitchRow
            key={server.name}
            isDark={isDark}
            palette={palette}
            borderBottom={i < servers.length - 1}
            index={i}
          >
            <View
              style={[
                styles.serverIcon,
                { backgroundColor: server.connected ? "rgba(52,199,89,0.12)" : "rgba(255,255,255,0.06)" },
              ]}
            >
              {server.connected ? (
                <Wifi size={16} color="#34C759" strokeWidth={2} />
              ) : (
                <Server size={16} color={palette.muted} strokeWidth={2} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>{server.name}</Text>
              <Text style={{ fontSize: 11, color: server.connected ? "#34C759" : palette.muted }}>
                {server.connected ? "Connected" : "Disconnected"}
              </Text>
            </View>
            <AnimatedSwitch
              value={server.enabled}
              onValueChange={(val: boolean) => {
                void triggerHaptic("selection")
                onMcpToggle?.(server.name, val)
              }}
              palette={palette}
            />
          </AnimatedSwitchRow>
        ))
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
            <Server size={24} color={palette.muted} strokeWidth={1.5} />
          </View>
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink, marginBottom: 4 }}>No MCP servers</Text>
          <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center" }}>
            Configure MCP servers to enable AI tool integrations
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

function SkillsContent({
  skills = [],
  onSkillSelect,
}: {
  skills?: Array<{ name: string; description?: string }>
  onSkillSelect?(name: string): void
}) {
  const { palette, isDark } = useAppTheme()
  const [search, setSearch] = useState("")

  const filtered = skills.filter((s) => !search.trim() || s.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: palette.border },
          ]}
        >
          <Search size={14} color={palette.muted} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search skills..."
              placeholderTextColor={palette.muted}
              style={{ fontSize: 14, color: palette.ink, paddingVertical: 0 }}
            />
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {filtered.length > 0 ? (
          filtered.map((skill, i) => (
            <AnimatedListItem
              key={skill.name}
              onPress={() => {
                void triggerHaptic("selection")
                onSkillSelect?.(skill.name)
              }}
              isDark={isDark}
              palette={palette}
              index={i}
              borderBottom={i < filtered.length - 1}
            >
              <View
                style={[
                  styles.skillIcon,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.07)" },
                ]}
              >
                <Sparkles size={16} color={palette.accentLight} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>{skill.name}</Text>
                {skill.description && (
                  <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }} numberOfLines={1}>
                    {skill.description}
                  </Text>
                )}
              </View>
              <Brain size={14} color={palette.muted} strokeWidth={2} />
            </AnimatedListItem>
          ))
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
              <Sparkles size={24} color={palette.muted} strokeWidth={1.5} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink, marginBottom: 4 }}>
              {search ? "No matching skills" : "No skills available"}
            </Text>
            <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center" }}>
              {search ? "Try a different search term" : "Skills will appear here when installed"}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

function ToolsContent({
  tools = [],
  onToolSelect,
}: {
  tools?: Array<{ name: string; description?: string; enabled?: boolean }>
  onToolSelect?: (name: string) => void
}) {
  const { palette, isDark } = useAppTheme()

  return (
    <ScrollView style={{ paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
      {tools.length > 0 ? (
        tools.map((tool, i) => (
          <AnimatedListItem
            key={tool.name}
            onPress={() => {
              void triggerHaptic("selection")
              onToolSelect?.(tool.name)
            }}
            isDark={isDark}
            palette={palette}
            index={i}
            borderBottom={i < tools.length - 1}
          >
            <View
              style={[
                styles.toolIcon,
                { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.07)" },
              ]}
            >
              <Terminal size={16} color={palette.accentLight} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>{tool.name}</Text>
              {tool.description ? (
                <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }} numberOfLines={1}>
                  {tool.description}
                </Text>
              ) : null}
            </View>
            <ChevronRight size={14} color={palette.muted} strokeWidth={2} />
          </AnimatedListItem>
        ))
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
            <Terminal size={24} color={palette.muted} strokeWidth={1.5} />
          </View>
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink, marginBottom: 4 }}>
            No commands available
          </Text>
          <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center" }}>
            Commands will appear here when the session is active
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

function AnimatedTabButton({
  children,
  isActive,
  onPress,
  palette,
}: {
  children: React.ReactNode
  isActive: boolean
  onPress: () => void
  palette: { accent: string; muted: string; accentLight: string; panel: string; border: string }
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
      useNativeDriver: false,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: false,
    }).start()
  }

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.border, palette.accent],
  })

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={[
          styles.drawerTab,
          {
            transform: [{ scale: scaleAnim }],
            borderColor,
            borderWidth: 1,
            backgroundColor: isActive ? palette.accent : palette.panel,
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}

function AnimatedListItem({
  children,
  onPress,
  isDark,
  borderBottom,
}: {
  children: React.ReactNode
  onPress: () => void
  isDark: boolean
  palette?: { ink: string; accentLight: string; muted: string }
  index?: number
  borderBottom: boolean
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
          gap: 14,
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderBottomWidth: borderBottom ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.08)",
        }}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}

function AnimatedSwitchRow({
  children,
  isDark,
  borderBottom,
}: {
  children: React.ReactNode
  isDark: boolean
  palette?: { ink: string; accentLight: string; muted: string; accent: string; border: string }
  index?: number
  borderBottom: boolean
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current

  return (
    <Animated.View
      style={{
        transform: [{ scale: scaleAnim }],
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: borderBottom ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.08)",
      }}
    >
      {children}
    </Animated.View>
  )
}

function AnimatedSwitch({
  value,
  onValueChange,
  palette,
}: {
  value: boolean
  onValueChange: (val: boolean) => void
  palette: { accent: string; border: string }
}) {
  const toggleAnim = useRef(new Animated.Value(value ? 1 : 0)).current
  const scaleAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.spring(toggleAnim, {
      toValue: value ? 1 : 0,
      damping: 20,
      stiffness: 300,
      mass: 0.7,
      useNativeDriver: false,
    }).start()
  }, [value, toggleAnim])

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

  const thumbTranslateX = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 18],
  })

  const trackScaleX = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  })

  const trackTransform = [{ scaleX: trackScaleX }, { scale: scaleAnim }]

  return (
    <Pressable onPress={() => onValueChange(!value)} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={{
          transform: trackTransform,
          width: 50,
          height: 30,
          borderRadius: 15,
          backgroundColor: toggleAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [palette.border, palette.accent],
          }),
          padding: 2,
        }}
      >
        <Animated.View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: "#fff",
            transform: [{ translateX: thumbTranslateX }],
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
          }}
        />
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 4,
  },
  toolButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    width: 1,
    height: 24,
    marginHorizontal: 4,
  },
  tabButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  tabBadge: {
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: "700",
  },
  drawerTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  drawerContent: {
    paddingBottom: 36,
  },
  currentModel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  modelIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  serverIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  skillIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  toolIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
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
})
