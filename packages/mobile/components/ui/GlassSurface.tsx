import { useState, useEffect, type PropsWithChildren, type ViewProps } from "react"
import { Platform, View } from "react-native"
import * as Glass from "expo-glass-effect"
import { cn } from "@/lib/cn"
import { useAppTheme, type GlassTokens } from "@/lib/theme"

export type GlassEffectStyle = "clear" | "regular" | "none" | {
  /**
   * Enable/disable animation on glass effect changes
   */
  animate?: boolean
  /**
   * Animation duration in milliseconds (default: 300)
   */
  animationDuration?: number
}

export type GlassColorScheme = "auto" | "light" | "dark"

export interface GlassSurfaceProps extends Omit<ViewProps, "style"> {
  /**
   * Glass effect intensity/style
   * - "clear": subtle glass effect (shell level - headers, tabs, overlays)
   * - "regular": standard glass effect (panel level - cards, sheets)
   * - "none": no glass effect (fallback mode)
   * - object: animated config { animate?: boolean, animationDuration?: number }
   * @default "regular"
   */
  glassEffectStyle?: GlassEffectStyle
  /**
   * Override color scheme for glass (useful for modals/sheets)
   * @default "auto"
   */
  colorScheme?: GlassColorScheme
  /**
   * Optional tint color (hex or rgba) to blend with glass
   */
  tintColor?: string
  /**
   * Whether this surface is interactive (affects blur intensity)
   * @default false
   */
  isInteractive?: boolean
  /**
   * Additional class names for styling
   */
  className?: string
  /**
   * Force fallback mode even on supported platforms
   * @default false
   */
  forceFallback?: boolean
}

// Check if expo-glass-effect is available
function isGlassEffectAPIAvailable(): boolean {
  return (
    typeof Glass !== "undefined" &&
    typeof Glass.LiquidGlass === "object" &&
    typeof (Glass.LiquidGlass as unknown as { render: unknown }).render === "function"
  )
}

function getColorSchemeOverride(scheme: GlassColorScheme, isDark: boolean): "light" | "dark" {
  if (scheme === "auto") {
    return isDark ? "dark" : "light"
  }
  return scheme
}

// Parse glass effect style to get animation config
function parseGlassStyle(style: GlassEffectStyle): {
  effect: "clear" | "regular" | "none"
  animate: boolean
  animationDuration: number
} {
  if (typeof style === "object") {
    return {
      effect: style.animate === false ? "clear" : "regular",
      animate: style.animate ?? true,
      animationDuration: style.animationDuration ?? 300,
    }
  }
  return {
    effect: style,
    animate: false,
    animationDuration: 0,
  }
}

/**
 * GlassSurface - Native glass effect wrapper with fallback
 * 
 * IMPORTANT ANIMATION CONSTRAINT:
 * Do NOT use opacity animations on GlassView components.
 * Instead, use glassEffectStyle.animate + animationDuration for smooth transitions.
 * Opacity changes on glass can cause render artifacts and visual glitches.
 * 
 * Usage patterns:
 * - Agent 3 (Shell): glassEffectStyle="clear" for tab bar, header, drawer
 * - Agent 4 (Cards): glassEffectStyle="regular" with form-safe interiors
 * - Agent 5 (Compose): glassEffectStyle="regular" with animated transitions
 * 
 * @example
 * // Shell surface (tabs, header, drawer)
 * <GlassSurface glassEffectStyle="clear" />
 * 
 * @example
 * // Panel surface with animation
 * <GlassSurface 
 *   glassEffectStyle={{ animate: true, animationDuration: 250 }}
 *   colorScheme="dark"
 * />
 * 
 * @example
 * // Interactive card
 * <GlassSurface isInteractive className="rounded-2xl" />
 */
export function GlassSurface({
  glassEffectStyle = "regular",
  colorScheme = "auto",
  tintColor,
  isInteractive = false,
  className,
  forceFallback = false,
  children,
  ...viewProps
}: PropsWithChildren<GlassSurfaceProps>) {
  const { isDark, glass } = useAppTheme()
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)

  // Check API availability on mount
  useEffect(() => {
    if (Platform.OS === "ios") {
      setIsAvailable(isGlassEffectAPIAvailable())
    } else {
      setIsAvailable(false)
    }
  }, [])

  // Determine if we should use native glass
  const useNativeGlass = 
    !forceFallback && 
    Platform.OS === "ios" && 
    isAvailable !== false

  // Parse the style config
  const { effect, animate, animationDuration } = parseGlassStyle(glassEffectStyle)

  // Handle "none" as fallback
  if (effect === "none" || !useNativeGlass) {
    return (
      <FallbackGlassView
        glass={glass}
        isDark={isDark}
        colorScheme={colorScheme}
        tintColor={tintColor}
        isInteractive={isInteractive}
        className={className}
        {...viewProps}
      >
        {children}
      </FallbackGlassView>
    )
  }

  // Map our style to expo-glass-effect's liquidGlassStyle
  const liquidGlassStyle = effect === "clear" ? "clear" : "regular"

  // Map colorScheme to "light" | "dark"
  const glassColorScheme = getColorSchemeOverride(colorScheme, isDark)

  // Build the LiquidGlass props
  const glassProps: Parameters<typeof Glass.LiquidGlass>[0] = {
    liquidGlassStyle,
    colorScheme: glassColorScheme,
    isInteractive,
    ...(animate && { animate, animationDuration }),
    ...(tintColor && { tintColor }),
    style: viewProps.style,
  }

  return (
    <Glass.LiquidGlass
      {...glassProps}
      className={cn(className)}
    >
      {children}
    </Glass.LiquidGlass>
  )
}

// Fallback component for non-iOS platforms or when API unavailable
interface FallbackGlassViewProps {
  glass: GlassTokens
  isDark: boolean
  colorScheme: GlassColorScheme
  tintColor?: string
  isInteractive: boolean
  className?: string
  style?: ViewProps["style"]
}

function FallbackGlassView({
  glass,
  isDark,
  colorScheme,
  tintColor,
  isInteractive,
  className,
  style,
  children,
}: PropsWithChildren<FallbackGlassViewProps>) {
  // Determine effective color scheme
  const effectiveIsDark = colorScheme === "auto" ? isDark : colorScheme === "dark"

  // Use different glass intensities based on effective scheme
  const bgColor = effectiveIsDark ? glass.glassShell : glass.glassShell
  const borderColor = effectiveIsDark ? glass.glassBorderStrong : glass.glassBorder

  // Apply tint if provided
  const finalBackground = tintColor || bgColor

  return (
    <View
      className={cn(
        "overflow-hidden",
        isInteractive && "active:opacity-90",
        className,
      )}
      style={[
        {
          backgroundColor: finalBackground,
          borderColor: borderColor,
          borderWidth: 1,
        },
        style as object,
      ]}
    >
      {children}
    </View>
  )
}

// Re-export types for consumers
export type { GlassTokens }
