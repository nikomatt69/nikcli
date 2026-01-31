import { View, StyleSheet, Pressable } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { MotiView } from "moti"
import { RefreshCw } from "lucide-react-native"
import { Button } from "../ui/Button"

interface ReconnectOverlayProps {
  visible: boolean
  status: "error" | "reconnecting"
  attempt: number
  maxAttempts?: number
  error?: string
  onRetry: () => void
  onCancel?: () => void
}

export function ReconnectOverlay({
  visible,
  status,
  attempt,
  maxAttempts = 10,
  error,
  onRetry,
  onCancel,
}: ReconnectOverlayProps) {
  const theme = useTheme()

  if (!visible) return null

  const isReconnecting = status === "reconnecting"
  const progress = Math.min(attempt / maxAttempts, 1)

  return (
    <MotiView
      from={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 200 }}
      style={styles.overlay}
    >
      <MotiView
        from={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 20 }}
        style={[styles.modal, { backgroundColor: theme.colors.surface }]}
      >
        <MotiView
          animate={{ rotate: isReconnecting ? 360 : 0 }}
          transition={{
            loop: isReconnecting,
            duration: 1500,
            type: "timing",
          }}
          style={styles.iconContainer}
        >
          <RefreshCw size={48} color={isReconnecting ? theme.colors.primary : theme.colors.error} />
        </MotiView>

        <Text style={[styles.title, { color: theme.colors.onSurface }]}>
          {isReconnecting ? "Reconnecting..." : "Connection Lost"}
        </Text>

        {error && <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text>}

        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: theme.colors.surfaceVariant }]}>
            <MotiView
              from={{ width: "0%" }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 300 }}
              style={[
                styles.progressFill,
                { backgroundColor: isReconnecting ? theme.colors.primary : theme.colors.error },
              ]}
            />
          </View>
          <Text style={[styles.attemptText, { color: theme.colors.onSurfaceVariant }]}>
            Attempt {attempt} of {maxAttempts}
          </Text>
        </View>

        <View style={styles.actions}>
          {!isReconnecting && <Button title="Retry Now" onPress={onRetry} fullWidth />}
          {onCancel && (
            <Pressable onPress={onCancel} style={styles.cancelButton}>
              <Text style={[styles.cancelText, { color: theme.colors.onSurfaceVariant }]}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </MotiView>
    </MotiView>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "80%",
    maxWidth: 320,
    padding: 24,
    borderRadius: 16,
    alignItems: "center",
    gap: 16,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
  error: {
    fontSize: 14,
    textAlign: "center",
  },
  progressContainer: {
    width: "100%",
    gap: 8,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  attemptText: {
    fontSize: 12,
    textAlign: "center",
  },
  actions: {
    width: "100%",
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    padding: 12,
  },
  cancelText: {
    fontSize: 14,
    textAlign: "center",
  },
})
