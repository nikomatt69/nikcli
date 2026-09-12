import { useState } from "react"
import { LayoutAnimation, Text, View } from "react-native"
import { DisclosureRow } from "@/components/ui/DisclosureRow"
import { usePrefersReducedMotion } from "@/lib/animation"
import { scaffoldingText } from "@/lib/transcript-rows"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import type { MessageWithParts } from "@/lib/types"

/**
 * Context the host injected on the user's behalf, folded down to one line.
 * It is part of the record — tapping shows it verbatim — but it never reads as
 * something the user typed.
 */
export function ScaffoldingRow({ message }: { message: MessageWithParts }) {
  const { palette } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [open, setOpen] = useState(false)
  const text = scaffoldingText(message)

  return (
    <View>
      <DisclosureRow
        label="Session initialized"
        onPress={() => {
          if (!prefersReducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
          setOpen((value) => !value)
        }}
      />
      {open && text ? (
        <View
          style={{
            marginBottom: 8,
            borderRadius: 14,
            borderCurve: "continuous",
            backgroundColor: hexToRgba(palette.ink, 0.04),
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text selectable style={{ color: palette.soft, fontFamily: "Menlo", fontSize: 12, lineHeight: 18 }}>
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
