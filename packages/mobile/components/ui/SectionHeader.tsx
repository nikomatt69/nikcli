import { Text } from "react-native"
import { useAppTheme } from "@/lib/theme"

/** Quiet list section label ("Today", "Pinned", …). */
export function SectionHeader({ label }: { label: string }) {
  const { palette } = useAppTheme()
  return (
    <Text
      style={{
        fontSize: 13,
        fontWeight: "500",
        color: palette.muted,
        paddingTop: 18,
        paddingBottom: 6,
        paddingHorizontal: 4,
      }}
    >
      {label}
    </Text>
  )
}
