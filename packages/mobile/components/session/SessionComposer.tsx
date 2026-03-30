import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native"
import { ArrowUp, Paperclip } from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { InfoChip } from "@/components/ui/InfoChip"
import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/cn"
import { useAppTheme } from "@/lib/theme"

type SessionComposerProps = {
  mode: "plan" | "code"
  setMode(mode: "plan" | "code"): void
  input: string
  setInput(value: string): void
  slashSuggestions?: Array<{
    name: string
    description?: string
    badge?: string
  }>
  slashLoading?: boolean
  sending: boolean
  sessionBlocked: boolean
  cleaned: boolean
  onOpenCommands(): void
  onSelectSlash(name: string): void
  onSend(): void
  onAttach?(): void
}

export function SessionComposer({
  mode,
  setMode,
  input,
  setInput,
  slashSuggestions = [],
  slashLoading,
  sending,
  sessionBlocked,
  cleaned,
  onOpenCommands,
  onSelectSlash,
  onSend,
  onAttach,
}: SessionComposerProps) {
  const { width } = useWindowDimensions()
  const { colorScheme, palette, isDark } = useAppTheme()
  const compact = width < 390
  const statusColor = cleaned ? palette.danger : sessionBlocked ? palette.warn : palette.success
  const sendBlocked = sessionBlocked || cleaned || !input.trim()
  const sendDisabled = sending || sendBlocked
  const sendTone = sendBlocked ? "blocked" : sending ? "loading" : "active"
  const utilityButtonStyle = {
    borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.82)",
    backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.82)",
  } as const
  const modeSummary =
    mode === "plan"
      ? "Returns analysis first and avoids direct edits."
      : "Allows direct inspection, edits, and publish work."
  const disabledReason = cleaned
    ? "This GitHub worktree is read-only after cleanup."
    : sessionBlocked
      ? "Execution is still active. Wait until the session returns idle."
      : !input.trim()
        ? mode === "plan"
          ? "Add the planning request you want reviewed first."
          : "Add the coding instruction you want to send."
        : null
  const liveHint = disabledReason ?? modeSummary
  const showSlashSuggestions = input.trimStart().startsWith("/")

  return (
    <View className="border-t border-border bg-background px-4 pb-3 pt-2">
      <View
        className="overflow-hidden rounded-[24px] border px-3 py-3"
        style={{
          borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.9)",
          backgroundColor: palette.surface,
          shadowColor: palette.shadow,
          shadowOpacity: isDark ? 0.22 : 0.08,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: -14,
            top: -18,
            width: 84,
            height: 84,
            borderRadius: 999,
            backgroundColor: isDark
              ? "rgba(255,255,255,0.03)"
              : mode === "code"
                ? "rgba(14,165,233,0.08)"
                : "rgba(232,240,248,0.7)",
          }}
        />
        <View className={`items-start gap-2 ${compact ? "" : "flex-row justify-between"}`}>
          <View className="min-w-0 flex-1 gap-1.5">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[10px] font-semibold uppercase tracking-[1.7px] text-accent-light">Composer</Text>
              <InfoChip
                label={mode === "plan" ? "Plan first" : "Code ready"}
                tone={mode === "plan" ? "neutral" : "accent"}
              />
              <Text className="text-[10px] font-semibold" style={{ color: statusColor }}>
                {cleaned ? "Read-only" : sessionBlocked ? "Busy" : "Ready"}
              </Text>
            </View>
            <Text className="text-[11px] leading-4 text-soft" numberOfLines={2}>
              {modeSummary}
            </Text>
          </View>

          <View
            className="self-start rounded-full p-1"
            style={{
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(193,208,223,0.82)",
              backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)",
            }}
          >
            <View className="flex-row items-center">
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  setMode("plan")
                }}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  backgroundColor: mode === "plan" ? (isDark ? "rgba(255,255,255,0.16)" : palette.panel) : "transparent",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: mode === "plan" ? palette.ink : palette.soft }}>Plan</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  setMode("code")
                }}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  backgroundColor: mode === "code" ? (isDark ? "rgba(255,255,255,0.94)" : palette.accent) : "transparent",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: mode === "code" ? "#0a0a0a" : palette.soft }}>Code</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className={`mt-2.5 items-end gap-2 ${compact ? "" : "flex-row"}`}>
          <View
            className="min-w-0 flex-1 rounded-[20px] border px-3 py-2.5"
            style={{
              borderColor: showSlashSuggestions
                ? isDark
                  ? "rgba(255,255,255,0.14)"
                  : "rgba(14,165,233,0.22)"
                : isDark
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(193,208,223,0.82)",
              backgroundColor: isDark ? "rgba(0,0,0,0.58)" : "rgba(241,246,251,0.84)",
            }}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              multiline
              editable={!cleaned}
              selectionColor={palette.accent}
              keyboardAppearance={colorScheme === "light" ? "light" : "dark"}
              placeholder={
                cleaned
                  ? "This GitHub worktree has been cleaned up."
                  : mode === "plan"
                    ? "Ask for the exact plan you want before editing..."
                    : "Ask Nikcli to inspect, edit, review, or publish..."
              }
              placeholderTextColor={palette.muted}
              className="max-h-24 min-h-[56px] text-[15px] leading-5 text-ink"
              textAlignVertical="top"
            />

            {showSlashSuggestions ? (
              <View className="mt-2 gap-2 border-t border-border/70 pt-2">
                {slashLoading ? (
                  <Text className="text-[11px] text-soft">Loading slash commands…</Text>
                ) : slashSuggestions.length ? (
                  slashSuggestions.slice(0, 4).map((item) => (
                    <Pressable
                      key={item.name}
                      onPress={() => {
                        void triggerHaptic("selection")
                        onSelectSlash(item.name)
                      }}
                      className="rounded-[14px] border border-border bg-surface px-3 py-2"
                    >
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="min-w-0 flex-1">
                          <Text className="text-[12px] font-semibold text-ink">/{item.name}</Text>
                          {item.description ? (
                            <Text className="mt-0.5 text-[11px] leading-4 text-soft" numberOfLines={2}>
                              {item.description}
                            </Text>
                          ) : null}
                        </View>
                        {item.badge ? (
                          <View className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1">
                            <Text className="text-[9px] font-semibold uppercase tracking-[1.2px] text-accent-light">
                              {item.badge}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <Text className="text-[11px] text-soft">No slash commands match this input yet.</Text>
                )}
              </View>
            ) : null}
          </View>
          <View className="self-end">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={sendDisabled}
              onPress={onSend}
              className={cn(
                "items-center justify-center overflow-hidden rounded-[20px] border",
                compact ? "h-[54px] w-[54px]" : "h-[58px] w-[58px]",
                sendTone === "blocked" ? "border-border bg-surface/90" : "border-accent/20 bg-accent",
              )}
              style={({ pressed }) => ({
                opacity: sendTone === "blocked" ? 0.5 : sendTone === "loading" ? 0.82 : pressed ? 0.9 : 1,
                shadowColor: palette.accent,
                shadowOpacity: sendTone === "active" ? (isDark ? 0.24 : 0.16) : 0,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 10 },
                transform: [{ scale: pressed && !sendDisabled ? 0.98 : 1 }],
              })}
            >
              <AdaptiveBlur
                tint={isDark ? "dark" : "light"}
                intensity={62}
                style={StyleSheet.absoluteFill}
                fallbackColor={sendTone === "blocked" ? (isDark ? "rgba(22,22,22,0.82)" : "rgba(241,246,251,0.86)") : palette.accent}
                pointerEvents="none"
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: sendDisabled
                      ? sendTone === "blocked"
                        ? isDark
                          ? "rgba(255,255,255,0.04)"
                          : "rgba(255,255,255,0.12)"
                        : isDark
                          ? "rgba(255,255,255,0.05)"
                          : "rgba(255,255,255,0.08)"
                      : isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(255,255,255,0.08)",
                  },
                ]}
                pointerEvents="none"
              />
              {sending ? (
                <ActivityIndicator color={isDark ? "#0a0a0a" : palette.codeText} />
              ) : (
                <ArrowUp
                  size={compact ? 18 : 20}
                  color={sendBlocked ? palette.muted : isDark ? "#0a0a0a" : palette.codeText}
                  strokeWidth={2.4}
                />
              )}
            </Pressable>
          </View>
        </View>

        <View className="mt-2 flex-row items-start justify-between gap-3">
          <Text className="min-w-0 flex-1 text-[10px] leading-4 text-soft" numberOfLines={2}>
            {liveHint}
          </Text>
          <View className="items-end gap-1">
            <View className="flex-row items-center gap-1.5">
              {onAttach ? (
                <Pressable
                  onPress={() => {
                    void triggerHaptic("selection")
                    onAttach()
                  }}
                  disabled={cleaned}
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    opacity: cleaned ? 0.6 : 1,
                    ...utilityButtonStyle,
                  }}
                >
                  <Paperclip size={13} color={palette.accent} strokeWidth={2.1} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  onOpenCommands()
                }}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  ...utilityButtonStyle,
                }}
              >
                <Text className="text-[10px] font-semibold uppercase tracking-[1.2px] text-accent-light">Commands</Text>
              </Pressable>
            </View>
            <Text className="text-[10px] text-soft" style={{ fontVariant: ["tabular-nums"] }}>
              {input.trim().length} chars
            </Text>
          </View>
        </View>
      </View>
    </View>
  )
}
