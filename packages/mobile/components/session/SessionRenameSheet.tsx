import { useEffect, useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { SheetShell } from "@/components/ui/SheetShell"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

const MAX_LENGTH = 120

type Props = {
  visible: boolean
  currentTitle: string
  saving: boolean
  onClose(): void
  onSave(title: string): void
}

export function SessionRenameSheet({ visible, currentTitle, saving, onClose, onSave }: Props) {
  const { palette, isDark } = useAppTheme()
  const [title, setTitle] = useState(currentTitle)
  const inputRef = useRef<TextInput>(null)

  const trimmed = title.trim()
  const disabled = !trimmed || trimmed === currentTitle.trim()
  const overLimit = title.length > MAX_LENGTH

  useEffect(() => {
    if (!visible) return
    setTitle(currentTitle)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [currentTitle, visible])

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      variant="inset"
      avoidKeyboard
      accessibilityLabel="Rename session"
      // Losing a half-typed title to a stray tap outside is not worth the convenience.
      dismissOnBackdropPress={false}
    >
      <View className="border-b border-border px-5 pb-4 pt-2">
        <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>Rename session</Text>
        <Text className="mt-2" style={{ color: palette.ink, ...typeStyle(22, { weight: "700" }) }}>
          Set a new title
        </Text>
        {currentTitle ? (
          <Text className="mt-1.5" style={{ color: palette.soft, ...typeStyle(13) }} numberOfLines={1}>
            Current: {currentTitle}
          </Text>
        ) : null}
      </View>

      <View className="px-5 pb-2 pt-5">
        <Text className="mb-2.5" style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>
          New title
        </Text>

        <View
          className="rounded-2xl px-4 py-3"
          style={{
            borderWidth: 1.5,
            borderColor: hexToRgba(palette.ink, isDark ? 0.22 : 0.24),
            backgroundColor: hexToRgba(palette.ink, isDark ? 0.06 : 0.04),
          }}
        >
          <TextInput
            ref={inputRef}
            value={title}
            onChangeText={(t) => setTitle(t.slice(0, MAX_LENGTH))}
            placeholder="Enter a session title…"
            placeholderTextColor={palette.muted}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={() => {
              if (!disabled && !saving && !overLimit) onSave(trimmed)
            }}
            style={{
              ...typeStyle(16, { weight: "500" }),
              color: palette.ink,
              padding: 0,
              margin: 0,
            }}
          />
        </View>

        <View className="mt-2 flex-row items-center justify-between">
          <Text style={{ color: palette.soft, ...typeStyle(12) }}>
            {title.length > 0 ? `${trimmed.length} characters` : "Start typing a title"}
          </Text>
          <Text style={{ color: overLimit ? palette.danger : palette.muted, ...typeStyle(12, { weight: "600" }) }}>
            {title.length}/{MAX_LENGTH}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2.5 px-5 pb-7 pt-3">
        <View className="flex-1">
          <ActionButton label="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
        </View>
        <View className="flex-1">
          <ActionButton
            label={saving ? "Saving…" : "Save"}
            disabled={disabled || saving || overLimit}
            loading={saving}
            onPress={() => onSave(trimmed)}
          />
        </View>
      </View>
    </SheetShell>
  )
}
