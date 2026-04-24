import { useRef } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ChevronRight } from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"

export function EditorBreadcrumb(props: {
  rootLabel: string
  segments: string[]
  onSegmentPress(index: number): void
}) {
  const { palette, isDark } = useAppTheme()
  const scrollRef = useRef<ScrollView>(null)

  const all = [props.rootLabel, ...props.segments]

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      contentContainerStyle={{ alignItems: "center", paddingHorizontal: 2, gap: 2 }}
      style={{ flexGrow: 0 }}
    >
      {all.map((segment, index) => {
        const isLast = index === all.length - 1
        return (
          <View key={index} style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
              onPress={() => props.onSegmentPress(index)}
              disabled={isLast}
              hitSlop={6}
              style={({ pressed }) => ({
                borderRadius: 8,
                paddingHorizontal: 7,
                paddingVertical: 3,
                backgroundColor: isLast
                  ? isDark
                    ? "rgba(255,255,255,0.09)"
                    : "rgba(14,165,233,0.10)"
                  : "transparent",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 12,
                  fontWeight: isLast ? "600" : "400",
                  color: isLast ? palette.accentLight : palette.muted,
                  maxWidth: 120,
                }}
              >
                {segment}
              </Text>
            </Pressable>
            {!isLast && (
              <ChevronRight
                size={11}
                color={isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)"}
                strokeWidth={2}
                style={{ marginHorizontal: 1 }}
              />
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}
