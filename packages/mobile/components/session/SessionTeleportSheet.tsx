import { useEffect, useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { SheetShell } from "@/components/ui/SheetShell"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"
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
    borderColor: hexToRgba(palette.ink, isDark ? 0.22 : 0.24),
    backgroundColor: hexToRgba(palette.ink, isDark ? 0.06 : 0.04),
  } as const

  const inputStyle = {
    ...typeStyle(16, { weight: "500" }),
    color: palette.ink,
    padding: 0,
    margin: 0,
  }

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      variant="inset"
      avoidKeyboard
      accessibilityLabel="Teleport session"
      // A typed-in server URL and token are tedious to re-enter; don't lose them to a stray tap.
      dismissOnBackdropPress={false}
    >
      <View className="border-b border-border px-5 pb-4 pt-2">
        <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>Teleport session</Text>
        <Text className="mt-2" style={{ color: palette.ink, ...typeStyle(22, { weight: "700" }) }}>
          Send to another server
        </Text>
        <Text className="mt-1.5" style={{ color: palette.soft, ...typeStyle(13) }}>
          Copies this conversation to a remote nikcli server so you can resume it there. The working files are only
          cloned when teleporting from the desktop or CLI.
        </Text>
      </View>

      <View className="px-5 pb-2 pt-5">
        <Text className="mb-2.5" style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>
          Server URL
        </Text>
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

        <Text className="mb-2.5 mt-4" style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>
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
    </SheetShell>
  )
}
