import { useCallback } from "react"
import * as Haptics from "expo-haptics"
import { useSettingsStore } from "../stores"

export function useHapticFeedback() {
  const settingsStore = useSettingsStore()

  const trigger = useCallback(
    (type: Haptics.ImpactFeedbackStyle | "success" | "error" | "warning") => {
      if (!settingsStore.haptic) return

      switch (type) {
        case "success":
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          break
        case "error":
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          break
        case "warning":
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          break
        default:
          Haptics.impactAsync(type as Haptics.ImpactFeedbackStyle)
      }
    },
    [settingsStore.haptic],
  )

  const light = useCallback(() => trigger(Haptics.ImpactFeedbackStyle.Light), [trigger])
  const medium = useCallback(() => trigger(Haptics.ImpactFeedbackStyle.Medium), [trigger])
  const heavy = useCallback(() => trigger(Haptics.ImpactFeedbackStyle.Heavy), [trigger])

  return { trigger, light, medium, heavy }
}
