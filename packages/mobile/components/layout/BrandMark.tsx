import { Image } from "react-native"
import { useAppTheme } from "@/lib/theme"

const WORDMARK_DARK = require("@/assets/wordmark-dark.png")
const WORDMARK_LIGHT = require("@/assets/wordmark-light.png")

/**
 * NIKCLI pixel wordmark, rendered bare (transparent background, no plate or
 * border). Uses the light-letter variant on dark themes and the ink-letter
 * variant on light themes.
 */
export function BrandMark({ height = 18 }: { height?: number }) {
  const { isDark } = useAppTheme()
  const width = Math.round(height * (632 / 206))
  return (
    <Image
      source={isDark ? WORDMARK_DARK : WORDMARK_LIGHT}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityLabel="NIKCLI"
    />
  )
}
