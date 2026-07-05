import { useRef, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { useAppTheme } from "@/lib/theme"

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

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        setTitle(currentTitle)
        requestAnimationFrame(() => inputRef.current?.focus())
      }}
    >
      <KeyboardAvoidingView
        className="flex-1"
        style={{ backgroundColor: isDark ? "rgba(2,6,23,0.74)" : "rgba(20,20,19,0.26)" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable className="flex-1" onPress={onClose} />

        <View
          className="mx-4 overflow-hidden rounded-[8px] border border-border bg-surface"
          style={{
            marginBottom: Platform.OS === "ios" ? 28 : 16,
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: -4 },
            elevation: 12,
          }}
        >
          {/* Header */}
          <View className="border-b border-border px-5 pb-4 pt-6">
            <Text className="text-[12px] font-medium text-muted">Rename session</Text>
            <Text className="mt-2 text-[22px] font-bold leading-[26px] tracking-tight text-ink">Set a new title</Text>
            {currentTitle ? (
              <Text className="mt-1.5 text-[13px] leading-5 text-soft" numberOfLines={1}>
                Current: {currentTitle}
              </Text>
            ) : null}
          </View>

          {/* Input area */}
          <View className="px-5 pb-2 pt-5">
            <Text className="mb-2.5 text-[12px] font-medium text-muted">New title</Text>

            <View
              className="rounded-2xl px-4 py-3"
              style={{
                borderWidth: 1.5,
                borderColor: isDark ? "rgba(56,189,248,0.30)" : "rgba(20,20,19,0.24)",
                backgroundColor: isDark ? "rgba(56,189,248,0.05)" : "rgba(20,20,19,0.04)",
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
                  fontSize: 16,
                  fontWeight: "500",
                  letterSpacing: -0.2,
                  color: palette.ink,
                  padding: 0,
                  margin: 0,
                }}
              />
            </View>

            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-[12px] leading-4 text-soft">
                {title.length > 0 ? `${trimmed.length} characters` : "Start typing a title"}
              </Text>
              <Text className={`text-[12px] font-semibold leading-4 ${overLimit ? "text-danger" : "text-muted"}`}>
                {title.length}/{MAX_LENGTH}
              </Text>
            </View>
          </View>

          {/* Actions */}
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
