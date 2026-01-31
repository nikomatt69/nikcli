import { View, StyleSheet, ActivityIndicator, Text } from "react-native"
import { useTheme } from "react-native-paper"

interface LoadingProps {
  size?: "small" | "large"
  text?: string
  fullScreen?: boolean
}

export function Loading({ size = "large", text, fullScreen = false }: LoadingProps) {
  const theme = useTheme()

  const containerStyle = fullScreen ? styles.fullScreenContainer : styles.container

  return (
    <View style={containerStyle}>
      <ActivityIndicator size={size} color={theme.colors.primary} />
      {text && <Text style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>{text}</Text>}
    </View>
  )
}

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const theme = useTheme()

  return (
    <View style={styles.emptyContainer}>
      {icon && <View style={styles.iconContainer}>{icon}</View>}
      <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>{title}</Text>
      {description && (
        <Text style={[styles.emptyDescription, { color: theme.colors.onSurfaceVariant }]}>{description}</Text>
      )}
      {action && <View style={styles.actionContainer}>{action}</View>}
    </View>
  )
}

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: ErrorStateProps) {
  const theme = useTheme()

  return (
    <View style={styles.errorContainer}>
      <Text style={[styles.errorTitle, { color: theme.colors.error }]}>{title}</Text>
      <Text style={[styles.errorMessage, { color: theme.colors.onSurfaceVariant }]}>{message}</Text>
      {onRetry && (
        <Text style={[styles.retryText, { color: theme.colors.primary }]} onPress={onRetry}>
          Tap to retry
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  fullScreenContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  text: {
    fontSize: 14,
    marginTop: 8,
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
    gap: 12,
  },
  iconContainer: {
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyDescription: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 4,
  },
  actionContainer: {
    marginTop: 16,
  },
  errorContainer: {
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  errorMessage: {
    fontSize: 14,
    textAlign: "center",
  },
  retryText: {
    fontSize: 14,
    marginTop: 12,
    fontWeight: "500",
  },
})
