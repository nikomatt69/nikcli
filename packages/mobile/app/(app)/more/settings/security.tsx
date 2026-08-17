import { useCallback, useState } from "react"
import { ScrollView, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import {
  authenticate,
  biometricLabel,
  getBiometricCapability,
  type BiometricCapability,
  type BiometricLabel,
} from "@/lib/biometrics"
import { triggerHaptic } from "@/lib/haptics"
import { setAppPreferencesWith } from "@/lib/storage"
import { useUIStore } from "@/lib/store"
import type { SecurityPreferences } from "@/lib/types"

export default function SecuritySettingsScreen() {
  const security = useUIStore((state) => state.security)
  const setSecurityPreference = useUIStore((state) => state.setSecurityPreference)
  const [capability, setCapability] = useState<BiometricCapability | null>(null)
  const [label, setLabel] = useState<BiometricLabel>("biometrics")
  const [enabling, setEnabling] = useState(false)

  const refreshCapability = useCallback(async () => {
    const next = await getBiometricCapability()
    setCapability(next)
    setLabel(biometricLabel(next.types))
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshCapability()
    }, [refreshCapability]),
  )

  async function persist<K extends keyof SecurityPreferences>(key: K, value: SecurityPreferences[K]) {
    setSecurityPreference(key, value)
    await setAppPreferencesWith((current) => ({
      ...current,
      security: {
        ...current.security,
        [key]: value,
      },
    }))
  }

  const canEnable = Boolean(capability?.available && capability.enrolled)

  async function toggleBiometrics() {
    if (security.biometricsEnabled) {
      await persist("biometricsEnabled", false)
      void triggerHaptic("selection")
      return
    }
    if (!canEnable) return
    setEnabling(true)
    try {
      const ok = await authenticate(`Enable ${label} to unlock nikcli`)
      if (!ok) return
      await persist("biometricsEnabled", true)
      void triggerHaptic("success")
    } finally {
      setEnabling(false)
    }
  }

  async function toggleLockOnBackground() {
    await persist("lockOnBackground", !security.lockOnBackground)
    void triggerHaptic("selection")
  }

  async function toggleConfirmSensitive() {
    await persist("confirmSensitiveActions", !security.confirmSensitiveActions)
    void triggerHaptic("selection")
  }

  const hardwareMissing = capability !== null && !capability.available
  const notEnrolled = capability !== null && capability.available && !capability.enrolled

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 36, gap: 16 }}
    >
      <SurfaceCard
        eyebrow="App lock"
        title={`Unlock with ${label}`}
        description="Require Face ID, Touch ID, or your device passcode when returning to nikcli."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip
            label={security.biometricsEnabled ? "On" : "Off"}
            tone={security.biometricsEnabled ? "good" : "neutral"}
          />
          {hardwareMissing ? <InfoChip label="No biometric hardware" tone="warn" /> : null}
          {notEnrolled ? <InfoChip label={`Set up ${label} in system settings`} tone="warn" /> : null}
          {canEnable ? <InfoChip label={`${label} ready`} tone="accent" /> : null}
        </View>
        <View className="mt-4">
          <ActionButton
            label={security.biometricsEnabled ? `${label} on` : `${label} off`}
            variant={security.biometricsEnabled ? "secondary" : "ghost"}
            loading={enabling}
            disabled={(!canEnable && !security.biometricsEnabled) || enabling}
            onPress={() => void toggleBiometrics()}
          />
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Background"
        title="Lock when leaving the app"
        description="Hide the session and require unlock after nikcli goes to the background."
      >
        <ActionButton
          label={security.lockOnBackground ? "On" : "Off"}
          variant={security.lockOnBackground ? "secondary" : "ghost"}
          onPress={() => void toggleLockOnBackground()}
        />
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Confirmations"
        title="Confirm sensitive actions"
        description="Ask for biometrics before destructive or credential-related actions. Other screens will use this preference."
      >
        <ActionButton
          label={security.confirmSensitiveActions ? "On" : "Off"}
          variant={security.confirmSensitiveActions ? "secondary" : "ghost"}
          onPress={() => void toggleConfirmSensitive()}
        />
      </SurfaceCard>
    </ScrollView>
  )
}
