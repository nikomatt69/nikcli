import { View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"

/**
 * Hairline separator derived from the theme ink color, so it adapts to any
 * theme in both light and dark mode. `inset` indents the left edge (list rows
 * with a leading dot/icon).
 */
export function Divider({ inset = 0 }: { inset?: number }) {
  const { palette } = useAppTheme()
  return <View style={{ height: 1, marginLeft: inset, backgroundColor: hexToRgba(palette.ink, 0.06) }} />
}
