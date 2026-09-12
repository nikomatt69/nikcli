import { Text } from "react-native"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

/** Quiet list section label ("Today", "Pinned", …). */
export function SectionHeader({ label }: { label: string }) {
  const { palette } = useAppTheme()
  return (
    <Text
      style={{
        color: palette.muted,
        paddingTop: 0,
        paddingBottom: 12,
        paddingHorizontal: 4,
        ...typeStyle(13, { weight: "600" }),
      }}
    >
      {label}
    </Text>
  )
}
