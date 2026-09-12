import { useMemo, useState } from "react"
import { Text, View, type LayoutChangeEvent } from "react-native"
import Svg, { Path } from "react-native-svg"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

const WAVE_HEIGHT = 10
const WAVELENGTH = 9
const AMPLITUDE = 2.4

/** A hand-drawn-looking rule: half-periods alternating above and below the centre line. */
function wavePath(width: number): string {
  if (width <= 0) return ""
  const mid = WAVE_HEIGHT / 2
  const half = WAVELENGTH / 2
  let path = `M0 ${mid}`
  let x = 0
  let up = true
  while (x < width) {
    const step = Math.min(half, width - x)
    path += ` q ${step / 2} ${up ? -AMPLITUDE : AMPLITUDE} ${step} 0`
    x += step
    up = !up
  }
  return path
}

function Wave({ color }: { color: string }) {
  const [width, setWidth] = useState(0)
  const path = useMemo(() => wavePath(width), [width])

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width)
    setWidth((current) => (current === next ? current : next))
  }

  return (
    <View style={{ flex: 1, height: WAVE_HEIGHT }} onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={WAVE_HEIGHT}>
          <Path d={path} stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  )
}

/**
 * Timestamp separator between transcript groups: a wavy rule running out to
 * both margins with the time set in the gap.
 */
export function TimeDivider({ label }: { label: string }) {
  const { palette } = useAppTheme()
  const color = hexToRgba(palette.ink, 0.18)

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 }}
    >
      <Wave color={color} />
      <Text style={{ color: palette.muted, ...typeStyle(13, { weight: "500" }) }}>{label}</Text>
      <Wave color={color} />
    </View>
  )
}
