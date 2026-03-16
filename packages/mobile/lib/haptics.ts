import * as ExpoHaptics from "expo-haptics"
import { Platform } from "react-native"
import { useUIStore } from "@/lib/store"

type HapticKind = "send" | "command" | "permission" | "error" | "success" | "selection"

function canTrigger(kind: HapticKind) {
  const prefs = useUIStore.getState().haptics
  if (!prefs.enabled || Platform.OS === "web") return false
  if (kind === "send") return prefs.send
  if (kind === "command" || kind === "selection") return prefs.commands
  if (kind === "permission") return prefs.permissions
  if (kind === "error") return prefs.errors
  return true
}

export async function triggerHaptic(kind: HapticKind) {
  if (!canTrigger(kind)) return

  try {
    if (kind === "send") {
      await ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light)
      return
    }

    if (kind === "command" || kind === "selection") {
      await ExpoHaptics.selectionAsync()
      return
    }

    if (kind === "permission") {
      await ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning)
      return
    }

    if (kind === "error") {
      await ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error)
      return
    }

    await ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success)
  } catch {
    // ignore haptic failures on unsupported devices
  }
}
