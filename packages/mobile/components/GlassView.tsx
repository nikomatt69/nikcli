import { type StyleProp, View, type ViewStyle } from "react-native"

type AdaptiveBlurProps = {
  /** Unused — kept for API compatibility so call sites don't need updating. */
  tint?: "light" | "dark" | "default" | "extraLight" | "regular" | "prominent" | string
  /** Unused — kept for API compatibility. */
  intensity?: number
  style?: StyleProp<ViewStyle>
  /** Background color rendered instead of a native blur layer. */
  fallbackColor: string
  children?: React.ReactNode
  pointerEvents?: "none" | "auto" | "box-none" | "box-only"
}

/**
 * Glass surface without native blur dependency.
 * Renders a semi-transparent View using the provided fallbackColor.
 * Drop-in replacement: accepts the same tint/intensity props as expo-blur
 * BlurView so call sites remain unchanged.
 */
export function AdaptiveBlur({ style, fallbackColor, children, pointerEvents }: AdaptiveBlurProps) {
  return (
    <View style={[style, { backgroundColor: fallbackColor }]} pointerEvents={pointerEvents}>
      {children}
    </View>
  )
}
