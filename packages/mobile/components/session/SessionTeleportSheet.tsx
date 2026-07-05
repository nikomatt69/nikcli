import { useEffect, useRef, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { useAppTheme } from "@/lib/theme"
import { getTeleportTarget } from "@/lib/storage"

type Props = {
  visible: boolean
  busy: boolean
  onClose(): void
  onTeleport(target: { url: string; token: string }): void
}

export function SessionTeleportSheet({ visible, busy, onClose, onTeleport }: Props) {
  const { palette, isDark } = useAppTheme()
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const urlRef = useRef<TextInput>(null)
  const tokenRef = useRef<TextInput>(null)

  // Prefill from the last successful teleport target.
  useEffect(() => {
    if (!visible) return
    let active = true
    void getTeleportTarget().then((saved) => {
      if (!active || !saved) return
      setUrl((prev) => prev || saved.url)
      setToken((prev) => prev || saved.token)
    })
    return () => {
      active = false
    }
  }, [visible])

  const trimmedUrl = url.trim()
  const trimmedToken = token.trim()
  const disabled = !trimmedUrl || !trimmedToken

  const inputWrapStyle = {
    borderWidth: 1.5,
    borderColor: isDark ? "rgba(56,189,248,0.30)" : "rgba(20,20,19,0.24)",
    backgroundColor: isDark ? "rgba(56,189,248,0.05)" : "rgba(20,20,19,0.04)",
  } as const

  const inputStyle = {
    fontSize: 16,
    fontWeight: "500" as const,
    letterSpacing: -0.2,
    color: palette.ink,
    padding: 0,
    margin: 0,
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => requestAnimationFrame(() => urlRef.current?.focus())}
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
            <Text className="text-[12px] font-medium text-muted">Teleport session</Text>
            <Text className="mt-2 text-[22px] font-bold leading-[26px] tracking-tight text-ink">
              Send to another server
            </Text>
            <Text className="mt-1.5 text-[13px] leading-5 text-soft">
              Copies this conversation to a remote nikcli server so you can resume it there. The working files are only
              cloned when teleporting from the desktop or CLI.
            </Text>
          </View>

          {/* Inputs */}
          <View className="px-5 pb-2 pt-5">
            <Text className="mb-2.5 text-[12px] font-medium text-muted">Server URL</Text>
            <View className="rounded-2xl px-4 py-3" style={inputWrapStyle}>
              <TextInput
                ref={urlRef}
                value={url}
                onChangeText={setUrl}
                placeholder="https://my-app.up.railway.app"
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
                onSubmitEditing={() => tokenRef.current?.focus()}
                style={inputStyle}
              />
            </View>

            <Text className="mb-2.5 mt-4 text-[12px] font-medium text-muted">
              Auth token
            </Text>
            <View className="rounded-2xl px-4 py-3" style={inputWrapStyle}>
              <TextInput
                ref={tokenRef}
                value={token}
                onChangeText={setToken}
                placeholder="mobile bearer token"
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (!disabled && !busy) onTeleport({ url: trimmedUrl, token: trimmedToken })
                }}
                style={inputStyle}
              />
            </View>
          </View>

          {/* Actions */}
          <View className="flex-row gap-2.5 px-5 pb-7 pt-3">
            <View className="flex-1">
              <ActionButton label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
            </View>
            <View className="flex-1">
              <ActionButton
                label={busy ? "Teleporting…" : "Teleport"}
                disabled={disabled || busy}
                loading={busy}
                onPress={() => onTeleport({ url: trimmedUrl, token: trimmedToken })}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
