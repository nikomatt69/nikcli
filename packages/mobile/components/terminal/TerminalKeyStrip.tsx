import { Pressable, ScrollView, Text, View } from "react-native"
import { triggerHaptic } from "@/lib/haptics"
import {
  resolveTerminalKeyInput,
  type TerminalKeyAction,
} from "@/lib/terminal-keys"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type Props = {
  keys: TerminalKeyAction[]
  disabled?: boolean
  ctrlActive: boolean
  shiftActive: boolean
  onToggleModifiers(next: { ctrl: boolean; shift: boolean }): void
  onFocusTerminal(): void
  onSendInput(data: string): void
  onHideKeyboard?(): void
  compact?: boolean
}

export function TerminalKeyStrip({
  keys,
  disabled = false,
  ctrlActive,
  shiftActive,
  onToggleModifiers,
  onFocusTerminal,
  onSendInput,
  onHideKeyboard,
  compact = false,
}: Props) {
  const { palette } = useAppTheme()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={{
        paddingHorizontal: compact ? 10 : 12,
        paddingTop: compact ? 8 : 10,
        paddingBottom: compact ? 8 : 6,
        gap: 8,
      }}
    >
      {keys.map((key) => {
        const stickyOn =
          (key.sticky === "ctrl" && ctrlActive) || (key.sticky === "shift" && shiftActive)
        return (
          <Pressable
            key={key.id}
            accessibilityRole="button"
            accessibilityLabel={key.label}
            disabled={disabled}
            onPress={() => {
              if (disabled) return
              void triggerHaptic("selection")
              const result = resolveTerminalKeyInput(key, { ctrl: ctrlActive, shift: shiftActive })
              onToggleModifiers(result.nextModifiers)
              if (result.action === "hide-keyboard") {
                onHideKeyboard?.()
                return
              }
              onFocusTerminal()
              if (result.data) onSendInput(result.data)
            }}
            style={({ pressed }) => ({
              minWidth: key.label.length > 4 ? 68 : 52,
              height: compact ? 40 : 44,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1,
              alignItems: "center",
              justifyContent: "center",
              opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
              backgroundColor: stickyOn
                ? hexToRgba(palette.accentLight, 0.18)
                : key.accent
                  ? hexToRgba(palette.danger, 0.12)
                  : hexToRgba(palette.ink, 0.08),
              borderColor: stickyOn
                ? hexToRgba(palette.accentLight, 0.35)
                : hexToRgba(palette.ink, 0.14),
            })}
          >
            <Text
              style={{
                fontSize: key.label.length === 1 ? 18 : 13,
                fontWeight: stickyOn || key.accent ? "700" : "600",
                color: stickyOn ? palette.accentLight : key.accent ? palette.danger : palette.soft,
                fontVariant: ["tabular-nums"],
              }}
            >
              {key.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export function TerminalKeyStripContainer({
  children,
  docked = false,
}: {
  children: React.ReactNode
  docked?: boolean
}) {
  const { palette } = useAppTheme()
  return (
    <View
      style={{
        flexShrink: 0,
        borderTopWidth: 1,
        borderTopColor: hexToRgba(palette.ink, 0.12),
        backgroundColor: "#0d0d0d",
        zIndex: docked ? 1 : undefined,
      }}
    >
      {children}
    </View>
  )
}
