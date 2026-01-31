import { useState } from "react"
import { View, StyleSheet, TextInput, Pressable, Text } from "react-native"
import { useTheme } from "react-native-paper"
import { Eye, EyeOff } from "lucide-react-native"

interface InputProps {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  label?: string
  error?: string
  secureTextEntry?: boolean
  keyboardType?: "default" | "email-address" | "url" | "numeric" | "phone-pad"
  autoCapitalize?: "none" | "sentences" | "words" | "characters"
  autoComplete?: "off" | "email" | "password" | "tel" | "username"
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  onSubmitEditing?: () => void
  returnKeyType?: "done" | "go" | "next" | "search" | "send"
}

export function Input({
  value,
  onChangeText,
  placeholder,
  label,
  error,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "none",
  autoComplete = "off",
  leftIcon,
  rightIcon,
  onSubmitEditing,
  returnKeyType = "done",
}: InputProps) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const isSecure = secureTextEntry && !showPassword

  return (
    <View style={styles.container}>
      {label && <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>{label}</Text>}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: theme.colors.surfaceVariant,
            borderColor: error ? theme.colors.error : focused ? theme.colors.primary : theme.colors.outline,
            borderWidth: focused || error ? 1.5 : 0.5,
          },
        ]}
      >
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          style={[
            styles.input,
            {
              color: theme.colors.onSurface,
              paddingLeft: leftIcon ? 8 : 16,
              paddingRight: rightIcon || secureTextEntry ? 40 : 16,
            },
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          secureTextEntry={isSecure}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
        />
        {(secureTextEntry || rightIcon) && (
          <View style={styles.rightIcon}>
            {secureTextEntry ? (
              <Pressable onPress={() => setShowPassword(!showPassword)}>
                {showPassword ? (
                  <EyeOff size={20} color={theme.colors.onSurfaceVariant} />
                ) : (
                  <Eye size={20} color={theme.colors.onSurfaceVariant} />
                )}
              </Pressable>
            ) : (
              rightIcon
            )}
          </View>
        )}
      </View>
      {error && <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  inputContainer: {
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  leftIcon: {
    paddingLeft: 12,
  },
  rightIcon: {
    paddingRight: 12,
  },
  error: {
    fontSize: 12,
    marginTop: 4,
  },
})
