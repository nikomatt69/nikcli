import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, BackHandler, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AdaptiveBlur } from "@/components/GlassView"
import { BrandMark } from "@/components/layout/BrandMark"
import { ActionButton } from "@/components/ui/ActionButton"
import { authenticate, biometricLabel, getBiometricCapability, type BiometricLabel } from "@/lib/biometrics"
import { hexToRgba, useAppTheme } from "@/lib/theme"

export function AppLockOverlay({ onUnlocked }: { onUnlocked: () => void }) {
  const { palette, isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const [label, setLabel] = useState<BiometricLabel>("Face ID")
  const [busy, setBusy] = useState(false)
  const inflight = useRef(false)
  const prompted = useRef(false)

  const requestUnlock = useCallback(
    async (prompt: string) => {
      if (inflight.current) return
      inflight.current = true
      setBusy(true)
      try {
        const ok = await authenticate(prompt)
        if (ok) onUnlocked()
      } finally {
        inflight.current = false
        setBusy(false)
      }
    },
    [onUnlocked],
  )

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true)
    return () => sub.remove()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function promptIfActive() {
      if (cancelled || prompted.current) return
      if (AppState.currentState !== "active") return
      prompted.current = true
      const capability = await getBiometricCapability()
      if (cancelled) return
      const nextLabel = biometricLabel(capability.types)
      setLabel(nextLabel)
      await requestUnlock(`Unlock nikcli with ${nextLabel}`)
    }

    void getBiometricCapability().then((capability) => {
      if (!cancelled) setLabel(biometricLabel(capability.types))
    })

    if (AppState.currentState === "active") {
      void promptIfActive()
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void promptIfActive()
    })

    return () => {
      cancelled = true
      sub.remove()
    }
  }, [requestUnlock])

  const unlockLabel = `Unlock with ${label}`

  return (
    <View
      accessibilityViewIsModal
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, { zIndex: 20000, backgroundColor: palette.background }]}
    >
      <AdaptiveBlur
        tint={isDark ? "systemThickMaterialDark" : "systemThickMaterialLight"}
        intensity={isDark ? 80 : 64}
        style={StyleSheet.absoluteFill}
        fallbackColor={hexToRgba(palette.background, 0.92)}
        opaqueFallbackColor={palette.background}
      />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 48,
          paddingBottom: Math.max(insets.bottom, 24) + 12,
          paddingHorizontal: 28,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ alignItems: "center", gap: 20, paddingTop: 48 }}>
          <BrandMark height={28} />
          <Text
            style={{
              color: palette.ink,
              fontSize: 22,
              fontWeight: "600",
              letterSpacing: -0.4,
              textAlign: "center",
            }}
          >
            nikcli is locked
          </Text>
          <Text style={{ color: palette.soft, fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 280 }}>
            Unlock with {label} or your device passcode to continue.
          </Text>
        </View>
        <View style={{ width: "100%", maxWidth: 360 }}>
          <ActionButton
            label={unlockLabel}
            loading={busy}
            accessibilityLabel={unlockLabel}
            onPress={() => void requestUnlock(`Unlock nikcli with ${label}`)}
          />
        </View>
      </View>
    </View>
  )
}
