import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Brain,
  BookMarked,
  Camera,
  ChevronRight,
  Code2,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  Image,
  Lock,
  MapPin,
  Mic,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Terminal,
  Wifi,
  X,
} from "lucide-react-native";
import { AdaptiveBlur } from "@/components/GlassView";
import { triggerHaptic } from "@/lib/haptics";
import { useAppTheme } from "@/lib/theme";
import {
  formatVariantLabel,
  type MobileModelOption,
} from "@/lib/model-catalog";

const styles = StyleSheet.create({
  gitBranchChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
});

// Animation constants
const SPRING_CONFIG = { damping: 20, stiffness: 260, mass: 0.8 };
const SPRING_CONFIG_FAST = { damping: 22, stiffness: 300, mass: 0.7 };

export type ComposerTab = "tools" | "skills" | "mcp" | "model";

// Stable empty defaults so memo() on child components sees the same
// reference across renders and doesn't redraw.
const EMPTY_AVAILABLE_MODELS: NonNullable<
  ComposerToolDrawerProps["availableModels"]
> = [];
const EMPTY_MCP_SERVERS: NonNullable<ComposerToolDrawerProps["mcpServers"]> =
  [];
const EMPTY_SKILLS: NonNullable<ComposerToolDrawerProps["skills"]> = [];
const EMPTY_TOOLS: NonNullable<ComposerToolDrawerProps["tools"]> = [];

export type ComposerToolDrawerProps = {
  visible: boolean;
  onClose(): void;
  activeTab: ComposerTab;
  onTabChange(tab: ComposerTab): void;
  modelLabel?: string;
  activeModelKey?: string;
  activeVariant?: string;
  availableModels?: MobileModelOption[];
  onModelSelect?(id: string, variant?: string): void;
  onOpenModelPicker?(): void;
  mcpServers?: Array<{ name: string; connected: boolean; enabled: boolean }>;
  onMcpToggle?(name: string, enabled: boolean): void;
  onMcpManage?(): void;
  skills?: Array<{ name: string; description?: string; category?: string }>;
  onSkillSelect?(name: string): void;
  onSkillsManage?(): void;
  onAttachFile?(): void;
  onAttachImage?(): void;
  onAttachCamera?(): void;
  tools?: Array<{ name: string; description?: string; enabled: boolean }>;
  onToolToggle?(name: string, enabled: boolean): void;
  onToolsManage?(): void;
  gitState?: {
    branch?: string;
    staged?: number;
    modified?: number;
    untracked?: number;
    commitsAhead?: number;
    commitsBehind?: number;
    hasPullRequest?: boolean;
    pullRequestUrl?: string;
  };
  onGitCommit?(): void;
  onGitPush?(): void;
  onGitPull?(): void;
  onGitPR?(): void;
  onGitRefresh?(): void;
};

const TAB_ICONS: Record<ComposerTab, React.ElementType> = {
  tools: Terminal,
  skills: Sparkles,
  mcp: Puzzle,
  model: Code2,
};

const TAB_LABELS: Record<ComposerTab, string> = {
  tools: "Tools",
  skills: "Skills",
  mcp: "MCP",
  model: "Model",
};

function getIconComponent(tab: ComposerTab) {
  switch (tab) {
    case "tools":
      return Terminal;
    case "skills":
      return Sparkles;
    case "mcp":
      return Puzzle;
    case "model":
      return Code2;
  }
}

export function ComposerToolDrawer({
  visible,
  onClose,
  activeTab,
  onTabChange,
  modelLabel,
  activeModelKey,
  activeVariant,
  availableModels = EMPTY_AVAILABLE_MODELS,
  onModelSelect,
  onOpenModelPicker,
  mcpServers = EMPTY_MCP_SERVERS,
  onMcpToggle,
  onMcpManage,
  skills = EMPTY_SKILLS,
  onSkillSelect,
  onSkillsManage,
  onAttachFile,
  onAttachImage,
  onAttachCamera,
  tools = EMPTY_TOOLS,
  onToolToggle,
  onToolsManage,
  gitState,
  onGitCommit,
  onGitPush,
  onGitPull,
  onGitPR,
  onGitRefresh,
}: ComposerToolDrawerProps) {
  const { colorScheme, palette, isDark } = useAppTheme();
  const { height: SCREEN_HEIGHT, height } = useWindowDimensions();
  const slideAnimRef = useRef<Animated.Value | null>(null);
  if (slideAnimRef.current === null)
    slideAnimRef.current = new Animated.Value(0);
  const slideAnim = slideAnimRef.current;
  const opacityAnimRef = useRef<Animated.Value | null>(null);
  if (opacityAnimRef.current === null)
    opacityAnimRef.current = new Animated.Value(0);
  const opacityAnim = opacityAnimRef.current;
  const contentScaleAnimRef = useRef<Animated.Value | null>(null);
  if (contentScaleAnimRef.current === null)
    contentScaleAnimRef.current = new Animated.Value(0.94);
  const contentScaleAnim = contentScaleAnimRef.current;

  useEffect(() => {
    const animation = visible
      ? Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.spring(slideAnim, {
            toValue: 1,
            ...SPRING_CONFIG,
            useNativeDriver: true,
          }),
          Animated.spring(contentScaleAnim, {
            toValue: 1,
            ...SPRING_CONFIG_FAST,
            useNativeDriver: true,
          }),
        ])
      : Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 160,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(contentScaleAnim, {
            toValue: 0.94,
            duration: 160,
            useNativeDriver: true,
          }),
        ]);
    animation.start();
    return () => animation.stop();
  }, [visible, opacityAnim, slideAnim, contentScaleAnim, onClose]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });
  const tabs = Object.keys(TAB_ICONS) as ComposerTab[];

  const connectedMcp = mcpServers.filter((s) => s.connected).length;
  const enabledSkills = skills.length;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: opacityAnim }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            <View style={{ flex: 1 }}>
              <AdaptiveBlur
                tint={isDark ? "dark" : "light"}
                intensity={isDark ? 20 : 14}
                style={StyleSheet.absoluteFill}
                fallbackColor={
                  isDark ? "rgba(0,0,0,0.72)" : "rgba(20,20,19,0.20)"
                }
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: isDark
                      ? "rgba(0,0,0,0.65)"
                      : "rgba(20,20,19,0.16)",
                  },
                ]}
              />
            </View>
          </Pressable>
        </Animated.View>

        <View style={{ paddingHorizontal: 10, paddingBottom: 24 }}>
          <Animated.View
            style={{
              transform: [{ translateY }, { scale: contentScaleAnim }],
              overflow: "hidden",
              borderRadius: 30,
              borderWidth: 1,
              borderColor: isDark
                ? "rgba(255,255,255,0.10)"
                : "rgba(255,255,255,0.82)",
              shadowColor: "#000",
              shadowOpacity: isDark ? 0.45 : 0.14,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 8 },
              elevation: 20,
              height: Math.min(SCREEN_HEIGHT * 0.75, height * 0.75),
            }}
          >
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={isDark ? 92 : 80}
              style={StyleSheet.absoluteFill}
              fallbackColor={
                isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"
              }
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark
                    ? "rgba(17,17,17,0.68)"
                    : "rgba(255,255,255,0.62)",
                },
              ]}
              pointerEvents="none"
            />

            <View style={{ padding: 10, flex: 1 }}>
              {/* Header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(20,20,19,0.08)",
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: isDark
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(20,20,19,0.15)",
                  }}
                >
                  {(() => {
                    const HeaderIcon = getIconComponent(activeTab);
                    return (
                      <HeaderIcon
                        size={14}
                        color={palette.accentLight}
                        strokeWidth={2.2}
                      />
                    );
                  })()}
                  <Text
                    style={{
                      fontSize: 10.5,
                      fontWeight: "700",
                      letterSpacing: 1.6,
                      textTransform: "uppercase",
                      color: palette.accentLight,
                    }}
                  >
                    {TAB_LABELS[activeTab]}
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  style={({ pressed }) => ({
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: isDark
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(255,255,255,0.80)",
                    backgroundColor: pressed
                      ? isDark
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(255,255,255,0.85)"
                      : isDark
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(255,255,255,0.55)",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: [{ scale: pressed ? 0.92 : 1 }],
                  })}
                >
                  <X size={13} color={palette.soft} strokeWidth={2.5} />
                </Pressable>
              </View>

              {/* Tab Bar */}
              <View
                style={{
                  flexDirection: "row",
                  gap: 4,
                  marginBottom: 12,
                  marginTop: 2,
                }}
              >
                {tabs.map((tab) => {
                  const Icon = getIconComponent(tab);
                  const isActive = activeTab === tab;

                  return (
                    <AnimatedTabButton
                      key={tab}
                      isActive={isActive}
                      onPress={() => {
                        void triggerHaptic("selection");
                        onTabChange(tab);
                      }}
                      palette={palette}
                      isDark={isDark}
                    >
                      <Icon
                        size={13}
                        color={isActive ? "#fff" : palette.muted}
                        strokeWidth={2.2}
                      />
                      <Text
                        style={{
                          fontSize: 11.5,
                          fontWeight: "600",
                          color: isActive ? "#fff" : palette.muted,
                        }}
                      >
                        {TAB_LABELS[tab]}
                      </Text>
                    </AnimatedTabButton>
                  );
                })}
              </View>

              {/* Tab Content */}
              <View
                style={{
                  flex: 1,
                  overflow: "hidden",
                  borderTopWidth: 1,
                  borderTopColor: isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(20,20,19,0.10)",
                }}
              >
                {activeTab === "model" && (
                  <ModelContent
                    modelLabel={modelLabel}
                    activeModelKey={activeModelKey}
                    activeVariant={activeVariant}
                    availableModels={availableModels}
                    onModelSelect={onModelSelect}
                    onOpenModelPicker={onOpenModelPicker}
                  />
                )}
                {activeTab === "mcp" && (
                  <McpContent
                    servers={mcpServers}
                    onMcpToggle={onMcpToggle}
                    onMcpManage={onMcpManage}
                  />
                )}
                {activeTab === "skills" && (
                  <SkillsContent
                    skills={skills}
                    onSkillSelect={onSkillSelect}
                    onSkillsManage={onSkillsManage}
                  />
                )}
                {activeTab === "tools" && (
                  <ToolsContent
                    tools={tools}
                    onToolToggle={onToolToggle}
                    onToolsManage={onToolsManage}
                  />
                )}
              </View>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function AttachContent({
  onAttachFile,
  onAttachImage,
  onAttachCamera,
}: {
  onAttachFile?(): void;
  onAttachImage?(): void;
  onAttachCamera?(): void;
}) {
  const { palette, isDark } = useAppTheme();

  const rows = [
    {
      Icon: FileText,
      label: "Document",
      desc: "PDF, TXT, code files",
      action: onAttachFile,
    },
    {
      Icon: Image,
      label: "Photo Library",
      desc: "JPG, PNG, HEIC",
      action: onAttachImage,
    },
    {
      Icon: Globe,
      label: "Camera",
      desc: "Take a photo",
      action: onAttachCamera,
    },
  ];

  return (
    <ScrollView
      style={{ paddingVertical: 12 }}
      showsVerticalScrollIndicator={false}
    >
      {rows.map((row, i) => (
        <Pressable
          key={row.label}
          onPress={() => {
            void triggerHaptic("selection");
            row.action?.();
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingHorizontal: 20,
            paddingVertical: 14,
            opacity: pressed ? 0.6 : 1,
            borderBottomWidth:
              i < rows.length - 1 ? StyleSheet.hairlineWidth : 0,
            borderBottomColor: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(20,20,19,0.08)",
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(20,20,19,0.09)",
            }}
          >
            <row.Icon size={20} color={palette.accentLight} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}
            >
              {row.label}
            </Text>
            <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}>
              {row.desc}
            </Text>
          </View>
          <ChevronRight size={16} color={palette.muted} strokeWidth={2} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function AnimatedTabButton({
  children,
  isActive,
  onPress,
  palette,
  isDark,
}: {
  children: React.ReactNode;
  isActive: boolean;
  onPress: () => void;
  palette: { accent: string; muted: string; accentLight: string };
  isDark: boolean;
}) {
  const scaleAnimRef = useRef<Animated.Value | null>(null);
  if (scaleAnimRef.current === null)
    scaleAnimRef.current = new Animated.Value(1);
  const scaleAnim = scaleAnimRef.current;
  const glowAnimRef = useRef<Animated.Value | null>(null);
  if (glowAnimRef.current === null)
    glowAnimRef.current = new Animated.Value(isActive ? 1 : 0);
  const glowAnim = glowAnimRef.current;

  useEffect(() => {
    Animated.spring(glowAnim, {
      toValue: isActive ? 1 : 0,
      damping: 22,
      stiffness: 260,
      mass: 0.7,
      useNativeDriver: false,
    }).start();
  }, [isActive, glowAnim]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.94,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["transparent", palette.accent],
  });

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 16,
          transform: [{ scale: scaleAnim }],
          borderColor,
          borderWidth: glowAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1.5],
          }),
          backgroundColor: isActive
            ? palette.accent
            : isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(20,20,19,0.08)",
        }}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

function AnimatedItemCard({
  children,
  onPress,
  isDark,
  borderBottom,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  isDark: boolean;
  index?: number;
  borderBottom: boolean;
}) {
  const scaleAnimRef = useRef<Animated.Value | null>(null);
  if (scaleAnimRef.current === null)
    scaleAnimRef.current = new Animated.Value(1);
  const scaleAnim = scaleAnimRef.current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      onPressIn={onPress ? handlePressIn : undefined}
      onPressOut={onPress ? handlePressOut : undefined}
    >
      <Animated.View
        style={{
          transform: [{ scale: scaleAnim }],
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 11,
          borderBottomWidth: borderBottom ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(20,20,19,0.08)",
        }}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

function EmptyState({
  icon: Icon,
  title,
  subtitle,
  palette,
  isDark,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  palette: { muted: string; ink: string; accentLight: string };
  isDark: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        paddingVertical: 32,
        paddingHorizontal: 20,
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(20,20,19,0.08)",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        <Icon size={22} color={palette.muted} strokeWidth={1.5} />
      </View>
      <Text
        style={{
          fontSize: 13.5,
          fontWeight: "600",
          color: palette.ink,
          marginBottom: 4,
        }}
      >
        {title}
      </Text>
      <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center" }}>
        {subtitle}
      </Text>
    </View>
  );
}

function AnimatedToggleSwitch({
  value,
  onValueChange,
  palette,
}: {
  value: boolean;
  onValueChange: (val: boolean) => void;
  palette: { accent: string; border: string };
}) {
  const toggleAnimRef = useRef<Animated.Value | null>(null);
  if (toggleAnimRef.current === null)
    toggleAnimRef.current = new Animated.Value(value ? 1 : 0);
  const toggleAnim = toggleAnimRef.current;
  const scaleAnimRef = useRef<Animated.Value | null>(null);
  if (scaleAnimRef.current === null)
    scaleAnimRef.current = new Animated.Value(1);
  const scaleAnim = scaleAnimRef.current;

  useEffect(() => {
    Animated.spring(toggleAnim, {
      toValue: value ? 1 : 0,
      damping: 20,
      stiffness: 300,
      mass: 0.7,
      useNativeDriver: false,
    }).start();
  }, [value, toggleAnim]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.94,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const thumbTranslateX = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 18],
  });

  const trackScaleX = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  const trackTransform = [{ scaleX: trackScaleX }, { scale: scaleAnim }];

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
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
  );
}

function ModelContent({
  modelLabel,
  activeModelKey,
  activeVariant,
  availableModels = EMPTY_AVAILABLE_MODELS,
  onModelSelect,
  onOpenModelPicker,
}: {
  modelLabel?: string;
  activeModelKey?: string;
  activeVariant?: string;
  availableModels?: MobileModelOption[];
  onModelSelect?(id: string, variant?: string): void;
  onOpenModelPicker?(): void;
}) {
  const { palette, isDark } = useAppTheme();
  const selected = availableModels.find((model) => model.id === activeModelKey);

  return (
    <ScrollView
      style={{ flex: 1, paddingVertical: 12 }}
      showsVerticalScrollIndicator={false}
    >
      {onOpenModelPicker ? (
        <Pressable
          onPress={() => {
            void triggerHaptic("selection");
            onOpenModelPicker();
          }}
          style={({ pressed }) => ({
            marginHorizontal: 16,
            marginBottom: 12,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: isDark
              ? "rgba(255,255,255,0.12)"
              : "rgba(20,20,19,0.16)",
            backgroundColor: isDark
              ? "rgba(255,255,255,0.05)"
              : "rgba(20,20,19,0.05)",
            paddingHorizontal: 14,
            paddingVertical: 12,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "700",
              color: palette.accentLight,
            }}
          >
            Open full model picker
          </Text>
          <Text style={{ fontSize: 11, color: palette.muted, marginTop: 4 }}>
            Search models and choose thinking effort like the CLI.
          </Text>
        </Pressable>
      ) : null}

      {selected && selected.variants.length > 0 ? (
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "700",
              color: palette.ink,
              marginBottom: 8,
            }}
          >
            Thinking effort
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <Pressable
              onPress={() => onModelSelect?.(selected.id, undefined)}
              style={{
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderWidth: 1,
                borderColor: !activeVariant ? palette.accent : palette.border,
                backgroundColor: !activeVariant
                  ? "rgba(52,199,89,0.12)"
                  : "transparent",
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: !activeVariant ? palette.accentLight : palette.soft,
                }}
              >
                Default
              </Text>
            </Pressable>
            {selected.variants.map((variant) => {
              const active = activeVariant === variant;
              return (
                <Pressable
                  key={variant}
                  onPress={() => onModelSelect?.(selected.id, variant)}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderWidth: 1,
                    borderColor: active ? palette.accent : palette.border,
                    backgroundColor: active
                      ? "rgba(52,199,89,0.12)"
                      : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      color: active ? palette.accentLight : palette.soft,
                    }}
                  >
                    {formatVariantLabel(variant)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {availableModels.map((model, i) => {
        const isActive = model.id === activeModelKey;
        return (
          <AnimatedItemCard
            key={model.id}
            onPress={() => {
              void triggerHaptic("selection");
              if (model.variants.length === 0)
                onModelSelect?.(model.id, undefined);
              else onModelSelect?.(model.id, model.variants[0]);
            }}
            isDark={isDark}
            borderBottom={i < availableModels.length - 1}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isActive
                  ? "rgba(20,20,19,0.18)"
                  : isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(20,20,19,0.08)",
              }}
            >
              <Brain
                size={15}
                color={isActive ? palette.accentLight : palette.muted}
                strokeWidth={2.2}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 13.5,
                  fontWeight: "600",
                  color: palette.ink,
                }}
              >
                {model.title}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  gap: 6,
                  marginTop: 4,
                  flexWrap: "wrap",
                }}
              >
                {isActive && (
                  <View
                    style={{
                      borderRadius: 6,
                      paddingHorizontal: 7,
                      paddingVertical: 2.5,
                      backgroundColor: "rgba(52,199,89,0.15)",
                      alignSelf: "flex-start",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 9,
                        fontWeight: "700",
                        color: "#34C759",
                      }}
                    >
                      Active
                    </Text>
                  </View>
                )}
                {model.badge && (
                  <View
                    style={{
                      borderRadius: 6,
                      paddingHorizontal: 7,
                      paddingVertical: 2.5,
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(20,20,19,0.08)",
                      alignSelf: "flex-start",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 9,
                        fontWeight: "700",
                        color: palette.accentLight,
                      }}
                    >
                      {model.badge}
                    </Text>
                  </View>
                )}
                {model.variants.length > 0 ? (
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "600",
                      color: palette.muted,
                    }}
                  >
                    {model.variants.length} thinking levels
                  </Text>
                ) : null}
              </View>
            </View>
            <ChevronRight size={14} color={palette.muted} strokeWidth={2} />
          </AnimatedItemCard>
        );
      })}
      {availableModels.length === 0 && (
        <EmptyState
          icon={Code2}
          title="No models available"
          subtitle="Configure AI models in settings"
          palette={palette}
          isDark={isDark}
        />
      )}
    </ScrollView>
  );
}

function McpContent({
  servers = EMPTY_MCP_SERVERS,
  onMcpToggle,
  onMcpManage,
}: {
  servers?: Array<{ name: string; connected: boolean; enabled: boolean }>;
  onMcpToggle?(name: string, enabled: boolean): void;
  onMcpManage?(): void;
}) {
  const { palette, isDark } = useAppTheme();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, paddingVertical: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {servers.length > 0 ? (
          servers.map((server, i) => {
            const statusIcon = server.connected ? (
              <Wifi size={15} color="#34C759" strokeWidth={2.2} />
            ) : !server.enabled ? (
              <Lock size={15} color={palette.muted} strokeWidth={2.2} />
            ) : (
              <Server size={15} color={palette.muted} strokeWidth={2.2} />
            );
            const statusText = server.connected
              ? "Connected"
              : !server.enabled
                ? "Disabled"
                : "Disconnected";
            const statusColor = server.connected ? "#34C759" : palette.muted;
            const iconBg = server.connected
              ? "rgba(52,199,89,0.12)"
              : isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.05)";

            return (
              <AnimatedItemCard
                key={server.name}
                onPress={() => onMcpToggle?.(server.name, !server.enabled)}
                isDark={isDark}
                borderBottom={i < servers.length - 1}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: iconBg,
                  }}
                >
                  {statusIcon}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 13.5,
                      fontWeight: "600",
                      color: palette.ink,
                    }}
                  >
                    {server.name}
                  </Text>
                  <Text style={{ fontSize: 11, color: statusColor }}>
                    {statusText}
                  </Text>
                </View>
                <AnimatedToggleSwitch
                  value={server.enabled}
                  onValueChange={(val: boolean) => {
                    void triggerHaptic("selection");
                    onMcpToggle?.(server.name, val);
                  }}
                  palette={palette}
                />
              </AnimatedItemCard>
            );
          })
        ) : (
          <EmptyState
            icon={Server}
            title="No MCP servers"
            subtitle="Configure MCP servers to enable AI tool integrations"
            palette={palette}
            isDark={isDark}
          />
        )}
      </ScrollView>

      {onMcpManage && (
        <AnimatedPressableText
          onPress={() => {
            void triggerHaptic("selection");
            onMcpManage();
          }}
          palette={palette}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: palette.accentLight,
            }}
          >
            Manage MCP Servers
          </Text>
          <ChevronRight size={14} color={palette.accentLight} strokeWidth={2} />
        </AnimatedPressableText>
      )}
    </View>
  );
}

function SkillsContent({
  skills = EMPTY_SKILLS,
  onSkillSelect,
  onSkillsManage,
}: {
  skills?: Array<{ name: string; description?: string; category?: string }>;
  onSkillSelect?(name: string): void;
  onSkillsManage?(): void;
}) {
  const { palette, isDark } = useAppTheme();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const term = search.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.description?.toLowerCase().includes(term),
    );
  }, [search, skills]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 14,
            borderWidth: 1,
            backgroundColor: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.04)",
            borderColor: palette.border,
          }}
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
            <AnimatedItemCard
              key={skill.name}
              onPress={() => {
                void triggerHaptic("selection");
                onSkillSelect?.(skill.name);
              }}
              isDark={isDark}
              borderBottom={i < filtered.length - 1}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(20,20,19,0.08)",
                }}
              >
                <Sparkles
                  size={15}
                  color={palette.accentLight}
                  strokeWidth={2.2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 13.5,
                    fontWeight: "600",
                    color: palette.ink,
                  }}
                >
                  {skill.name}
                </Text>
                {skill.description && (
                  <Text
                    style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {skill.description}
                  </Text>
                )}
              </View>
              <Brain size={14} color={palette.muted} strokeWidth={2} />
            </AnimatedItemCard>
          ))
        ) : (
          <EmptyState
            icon={Sparkles}
            title={search ? "No matching skills" : "No skills available"}
            subtitle={
              search
                ? "Try a different search term"
                : "Skills will appear here when installed"
            }
            palette={palette}
            isDark={isDark}
          />
        )}
      </ScrollView>

      {onSkillsManage && (
        <AnimatedPressableText
          onPress={() => {
            void triggerHaptic("selection");
            onSkillsManage();
          }}
          palette={palette}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: palette.accentLight,
            }}
          >
            Manage Skills
          </Text>
          <ChevronRight size={14} color={palette.accentLight} strokeWidth={2} />
        </AnimatedPressableText>
      )}
    </View>
  );
}

function GitContent({
  gitState,
  onGitCommit,
  onGitPush,
  onGitPull,
  onGitPR,
  onGitRefresh,
}: {
  gitState?: {
    branch?: string;
    staged?: number;
    modified?: number;
    untracked?: number;
    commitsAhead?: number;
    hasPullRequest?: boolean;
  };
  onGitCommit?(): void;
  onGitPush?(): void;
  onGitPull?(): void;
  onGitPR?(): void;
  onGitRefresh?(): void;
}) {
  const { palette, isDark } = useAppTheme();

  const actions = [
    {
      Icon: GitCommit,
      label: "Commit",
      desc: `${gitState?.staged ?? 0} staged`,
      action: onGitCommit,
    },
    {
      Icon: RefreshCw,
      label: "Pull",
      desc: `${gitState?.commitsAhead ?? 0} ahead`,
      action: onGitPull,
    },
    { Icon: GitBranch, label: "Push", desc: "Push changes", action: onGitPush },
    {
      Icon: GitPullRequest,
      label: "Pull Request",
      desc: gitState?.hasPullRequest ? "Open PR" : "Create PR",
      action: onGitPR,
    },
  ];

  return (
    <ScrollView
      style={{ paddingVertical: 12 }}
      showsVerticalScrollIndicator={false}
    >
      {gitState?.branch && (
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <View
            style={[
              styles.gitBranchChip,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(20,20,19,0.08)",
                borderColor: isDark
                  ? "rgba(255,255,255,0.10)"
                  : "rgba(20,20,19,0.20)",
              },
            ]}
          >
            <GitBranch size={12} color={palette.accentLight} strokeWidth={2} />
            <Text
              style={{ fontSize: 12, fontWeight: "600", color: palette.ink }}
            >
              {gitState.branch}
            </Text>
            <Pressable onPress={onGitRefresh} hitSlop={8}>
              <RefreshCw size={12} color={palette.muted} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      )}

      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {actions.map(({ Icon, label, desc, action }) => (
          <Pressable
            key={label}
            onPress={action}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              padding: 14,
              borderRadius: 16,
              backgroundColor: isDark
                ? "rgba(255,255,255,0.04)"
                : "rgba(20,20,19,0.04)",
              transform: [{ scale: pressed ? 0.97 : 1 }],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(20,20,19,0.08)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={18} color={palette.accentLight} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}
              >
                {label}
              </Text>
              <Text
                style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}
              >
                {desc}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function ToolsContent({
  tools = EMPTY_TOOLS,
  onToolToggle,
  onToolsManage,
}: {
  tools?: Array<{ name: string; description?: string; enabled: boolean }>;
  onToolToggle?(name: string, enabled: boolean): void;
  onToolsManage?(): void;
}) {
  const { palette, isDark } = useAppTheme();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return tools;
    const term = search.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(term) ||
        t.description?.toLowerCase().includes(term),
    );
  }, [search, tools]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 14,
            borderWidth: 1,
            backgroundColor: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.04)",
            borderColor: palette.border,
          }}
        >
          <Search size={14} color={palette.muted} strokeWidth={2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search tools..."
            placeholderTextColor={palette.muted}
            style={{
              flex: 1,
              fontSize: 14,
              color: palette.ink,
              paddingVertical: 0,
            }}
          />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {filtered.length > 0 ? (
          filtered.map((tool, i) => (
            <AnimatedItemCard
              key={tool.name}
              onPress={
                onToolToggle
                  ? () => onToolToggle(tool.name, !tool.enabled)
                  : undefined
              }
              isDark={isDark}
              borderBottom={i < filtered.length - 1}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(20,20,19,0.08)",
                }}
              >
                <Terminal
                  size={15}
                  color={palette.accentLight}
                  strokeWidth={2.2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 13.5,
                    fontWeight: "600",
                    color: palette.ink,
                  }}
                >
                  {tool.name}
                </Text>
                {tool.description && (
                  <Text
                    style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {tool.description}
                  </Text>
                )}
              </View>
              {onToolToggle ? (
                <AnimatedToggleSwitch
                  value={tool.enabled}
                  onValueChange={(val: boolean) => {
                    void triggerHaptic("selection");
                    onToolToggle(tool.name, val);
                  }}
                  palette={palette}
                />
              ) : (
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: palette.muted,
                  }}
                >
                  Available
                </Text>
              )}
            </AnimatedItemCard>
          ))
        ) : (
          <EmptyState
            icon={Terminal}
            title={search ? "No matching tools" : "No tools available"}
            subtitle={
              search
                ? "Try a different search term"
                : "Tools will appear here when available"
            }
            palette={palette}
            isDark={isDark}
          />
        )}
      </ScrollView>

      {onToolsManage && (
        <AnimatedPressableText
          onPress={() => {
            void triggerHaptic("selection");
            onToolsManage();
          }}
          palette={palette}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: palette.accentLight,
            }}
          >
            Manage Tools
          </Text>
          <ChevronRight size={14} color={palette.accentLight} strokeWidth={2} />
        </AnimatedPressableText>
      )}
    </View>
  );
}

function AnimatedPressableText({
  children,
  onPress,
  palette,
}: {
  children: React.ReactNode;
  onPress: () => void;
  palette: { accentLight: string };
}) {
  const scaleAnimRef = useRef<Animated.Value | null>(null);
  if (scaleAnimRef.current === null)
    scaleAnimRef.current = new Animated.Value(1);
  const scaleAnim = scaleAnimRef.current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 280,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 16,
        marginHorizontal: 20,
      }}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
