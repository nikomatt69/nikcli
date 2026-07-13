import { Image } from "react-native"
import { useAppTheme } from "@/lib/theme"
import { wordmarkForTheme, wordmarkWidthForHeight } from "@/lib/brand"

/**
 * NIKCLI pixel wordmark, rendered bare (transparent background, no plate or
 * border). Switches automatically with the current theme:
 * - dark UI  → `wordmark-dark.png` (pale letters)
 * - light UI → `wordmark-light.png` (ink letters)
 *
 * `wordmark.png` is the master/archival copy (same as dark) and is not used
 * at runtime — prefer this component or `wordmarkForTheme()`.
 */
export function BrandMark({ height = 18 }: { height?: number }) {
  const { isDark } = useAppTheme()
  const width = wordmarkWidthForHeight(height)
  return (
    <Image
      source={wordmarkForTheme(isDark)}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityLabel="NIKCLI"
    />
  )
}
