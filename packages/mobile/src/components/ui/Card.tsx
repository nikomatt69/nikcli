import { View, StyleSheet, Pressable } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { MotiView } from "moti"

interface CardProps {
  children: React.ReactNode
  variant?: "elevated" | "outlined" | "filled"
  padding?: "none" | "sm" | "md" | "lg"
  interactive?: boolean
  onPress?: () => void
}

export function Card({ children, variant = "elevated", padding = "md", interactive = false, onPress }: CardProps) {
  const theme = useTheme()

  const variantStyles = {
    elevated: {
      backgroundColor: theme.colors.surface,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    outlined: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.outline,
    },
    filled: {
      backgroundColor: theme.colors.surfaceVariant,
    },
  }

  const paddingSizes = {
    none: 0,
    sm: 12,
    md: 16,
    lg: 24,
  }

  const cardStyle = [styles.card, variantStyles[variant], { padding: paddingSizes[padding] }]

  if (interactive) {
    return (
      <MotiView from={{ scale: 1 }} animate={{ scale: onPress ? 1 : 1 }} style={cardStyle}>
        <Pressable onPress={onPress} style={({ pressed }) => [styles.interactiveContent, pressed && { opacity: 0.8 }]}>
          {children}
        </Pressable>
      </MotiView>
    )
  }

  return (
    <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} style={cardStyle}>
      {children}
    </MotiView>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
  },
  interactiveContent: {
    width: "100%",
  },
})
