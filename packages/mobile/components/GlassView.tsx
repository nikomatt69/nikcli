import { BlurView, type BlurTint } from "expo-blur"
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect"
import { Platform, View, type StyleProp, type ViewStyle } from "react-native"
import { usePrefersReducedTransparency } from "@/lib/animation"

type AdaptiveBlurProps = {
  tint?: "light" | "dark" | "default" | "extraLight" | "regular" | "prominent" | string
  intensity?: number
  style?: StyleProp<ViewStyle>
  fallbackColor: string
  opaqueFallbackColor?: string
  children?: React.ReactNode
  pointerEvents?: "none" | "auto" | "box-none" | "box-only"
  interactive?: boolean
}

const blurTints = new Set<BlurTint>([
  "light",
  "dark",
  "default",
  "extraLight",
  "regular",
  "prominent",
  "systemUltraThinMaterial",
  "systemThinMaterial",
  "systemMaterial",
  "systemThickMaterial",
  "systemChromeMaterial",
  "systemUltraThinMaterialLight",
  "systemThinMaterialLight",
  "systemMaterialLight",
  "systemThickMaterialLight",
  "systemChromeMaterialLight",
  "systemUltraThinMaterialDark",
  "systemThinMaterialDark",
  "systemMaterialDark",
  "systemThickMaterialDark",
  "systemChromeMaterialDark",
])

function resolveBlurTint(tint: AdaptiveBlurProps["tint"]): BlurTint {
  return tint && blurTints.has(tint as BlurTint) ? (tint as BlurTint) : "systemMaterial"
}

export function AdaptiveBlur({
  style,
  fallbackColor,
  opaqueFallbackColor = fallbackColor,
  children,
  pointerEvents,
  tint,
  intensity = 72,
  interactive = false,
}: AdaptiveBlurProps) {
  const prefersReducedTransparency = usePrefersReducedTransparency()

  if (prefersReducedTransparency) {
    return (
      <View style={[style, { backgroundColor: opaqueFallbackColor }]} pointerEvents={pointerEvents}>
        {children}
      </View>
    )
  }

  if (Platform.OS === "ios" && isLiquidGlassAvailable()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        style={[style, { backgroundColor: fallbackColor }]}
        pointerEvents={pointerEvents}
      >
        {children}
      </GlassView>
    )
  }

  return (
    <BlurView
      tint={resolveBlurTint(tint)}
      intensity={intensity}
      blurMethod="dimezisBlurViewSdk31Plus"
      style={[style, { backgroundColor: fallbackColor }]}
      pointerEvents={pointerEvents}
    >
      {children}
    </BlurView>
  )
}
