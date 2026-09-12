import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, Pressable, Text, View } from "react-native"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

export function NetworkBanner() {
  const { palette } = useAppTheme()
  const { client, config } = useServer()
  const [isReachable, setIsReachable] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const checkReachability = useCallback(async () => {
    if (!client) return
    try {
      const ok = await client.ping()
      setIsReachable(ok)
    } catch {
      setIsReachable(false)
    }
  }, [client])

  useEffect(() => {
    if (!config) return

    void checkReachability()

    intervalRef.current = setInterval(() => {
      void checkReachability()
    }, 30_000)

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkReachability()
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      subscription.remove()
    }
  }, [checkReachability, config])

  if (!config || isReachable) return null

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        backgroundColor: hexToRgba(palette.danger, 0.12),
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
      accessibilityLiveRegion="polite"
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
        <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: palette.danger }} />
        <Text style={{ color: palette.danger, ...typeStyle(14, { weight: "600" }) }}>Server unreachable</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry server connection"
        hitSlop={10}
        onPress={() => void checkReachability()}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.62 : 1 })}
      >
        <Text style={{ color: palette.danger, ...typeStyle(14, { weight: "700" }) }}>Retry</Text>
      </Pressable>
    </View>
  )
}
