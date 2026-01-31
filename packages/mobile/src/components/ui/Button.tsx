import { Pressable, StyleSheet, Text, ActivityIndicator, View } from "react-native"
import { useTheme } from "react-native-paper"
import type { ReactNode } from "react"

interface ButtonProps {
  onPress: () => void
  title: string
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
  fullWidth?: boolean
}

export function Button({
  onPress,
  title,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
}: ButtonProps) {
  const theme = useTheme()

  const isOutline = variant === "outline"
  const isDisabled = disabled || loading

  const buttonStyle = StyleSheet.flatten([
    styles.button,
    {
      backgroundColor:
        variant === "primary"
          ? theme.colors.primary
          : variant === "secondary"
            ? theme.colors.secondaryContainer
            : variant === "danger"
              ? theme.colors.error
              : "transparent",
      paddingVertical: size === "sm" ? 8 : size === "md" ? 12 : 16,
      paddingHorizontal: size === "sm" ? 12 : size === "md" ? 16 : 24,
      borderWidth: isOutline ? 1 : 0,
      borderColor: isOutline ? theme.colors.outline : undefined,
      opacity: isDisabled ? 0.6 : 1,
      width: fullWidth ? "100%" : undefined,
    },
  ])

  const textStyle = StyleSheet.flatten([
    styles.text,
    {
      color:
        variant === "primary"
          ? theme.colors.onPrimary
          : variant === "secondary"
            ? theme.colors.onSecondaryContainer
            : variant === "danger"
              ? theme.colors.onError
              : variant === "outline"
                ? theme.colors.primary
                : theme.colors.onSurface,
      fontSize: size === "sm" ? 14 : size === "md" ? 16 : 18,
    },
  ])

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [buttonStyle, pressed && !isDisabled && { opacity: 0.8, transform: [{ scale: 0.98 }] }]}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textStyle.color as string} />
      ) : (
        <View style={styles.contentContainer}>
          {icon && <View style={styles.icon}>{icon}</View>}
          <Text style={textStyle}>{title}</Text>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  contentContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    fontWeight: "600",
  },
  icon: {
    marginRight: 4,
  },
})
