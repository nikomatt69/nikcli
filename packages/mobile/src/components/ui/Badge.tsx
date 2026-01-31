import { View, StyleSheet, Pressable } from "react-native"
import { Text, useTheme } from "react-native-paper"

interface BadgeProps {
  children: React.ReactNode
  variant?: "default" | "primary" | "success" | "warning" | "error"
  size?: "sm" | "md"
}

export function Badge({ children, variant = "default", size = "md" }: BadgeProps) {
  const theme = useTheme()

  const variantStyles = {
    default: {
      backgroundColor: theme.colors.surfaceVariant,
      textColor: theme.colors.onSurfaceVariant,
    },
    primary: {
      backgroundColor: theme.colors.primaryContainer,
      textColor: theme.colors.onPrimaryContainer,
    },
    success: {
      backgroundColor: theme.colors.tertiaryContainer,
      textColor: theme.colors.onTertiaryContainer,
    },
    warning: {
      backgroundColor: theme.colors.errorContainer,
      textColor: theme.colors.onErrorContainer,
    },
    error: {
      backgroundColor: theme.colors.errorContainer,
      textColor: theme.colors.onErrorContainer,
    },
  }

  const sizeStyles = {
    sm: { paddingVertical: 2, paddingHorizontal: 6, fontSize: 10 },
    md: { paddingVertical: 4, paddingHorizontal: 8, fontSize: 12 },
  }

  const current = variantStyles[variant]
  const currentSize = sizeStyles[size]

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: current.backgroundColor,
          paddingVertical: currentSize.paddingVertical,
          paddingHorizontal: currentSize.paddingHorizontal,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: current.textColor,
            fontSize: currentSize.fontSize,
          },
        ]}
      >
        {children}
      </Text>
    </View>
  )
}

interface StatusDotProps {
  status: "active" | "idle" | "error" | "offline" | "stopped"
}

export function StatusDot({ status }: StatusDotProps) {
  const theme = useTheme()

  const statusColors = {
    active: theme.colors.primary,
    idle: theme.colors.secondary,
    error: theme.colors.error,
    offline: theme.colors.outline,
    stopped: theme.colors.outline,
  }

  return <View style={[styles.dot, { backgroundColor: statusColors[status] }]} />
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 100,
    alignSelf: "flex-start",
  },
  text: {
    fontWeight: "600",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
