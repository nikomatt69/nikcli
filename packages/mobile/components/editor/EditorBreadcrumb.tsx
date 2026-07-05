import { useRef } from "react"
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ChevronRight, FileCode, Folder, FileText } from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { PRESS_SPRING } from "@/lib/animation"

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".css",
  ".scss",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
]

function isCodeFile(name: string): boolean {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : ""
  return CODE_EXTENSIONS.includes(ext.toLowerCase())
}

function SegmentIcon({ name, size, color }: { name: string; size: number; color: string }) {
  if (isCodeFile(name)) {
    return <FileCode size={size} color={color} strokeWidth={2} />
  }
  return <FileText size={size} color={color} strokeWidth={2} />
}

export function EditorBreadcrumb(props: {
  rootLabel: string
  segments: string[]
  onSegmentPress(index: number): void
}) {
  const { palette, isDark } = useAppTheme()
  const scrollRef = useRef<ScrollView>(null)
  const scalesRef = useRef<Record<number, Animated.Value>>({})
  const all = [props.rootLabel, ...props.segments]
  const separatorColor = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)"

  function getScale(index: number): Animated.Value {
    if (!scalesRef.current[index]) {
      scalesRef.current[index] = new Animated.Value(1)
    }
    return scalesRef.current[index]
  }

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      contentContainerStyle={styles.container}
      style={{ flexGrow: 0 }}
    >
      <Folder size={11} color={palette.accentLight} strokeWidth={2} style={styles.folderIcon} />
      {all.map((segment, index) => {
        const isLast = index === all.length - 1
        const scale = getScale(index)
        return (
          <View key={segment} style={styles.segmentRow}>
            <Animated.View style={{ transform: [{ scale }] }}>
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  props.onSegmentPress(index)
                }}
                onPressIn={() => {
                  if (!isLast) Animated.spring(scale, { toValue: 0.93, ...PRESS_SPRING }).start()
                }}
                onPressOut={() => {
                  Animated.spring(scale, { toValue: 1, ...PRESS_SPRING }).start()
                }}
                disabled={isLast}
                hitSlop={6}
                style={{
                  ...styles.segment,
                  backgroundColor: isLast
                    ? isDark
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(20,20,19,0.10)"
                    : "transparent",
                  borderWidth: isLast ? 1 : 0,
                  borderColor: isLast ? (isDark ? "rgba(255,255,255,0.30)" : "rgba(20,20,19,0.20)") : "transparent",
                }}
              >
                {!isLast && <SegmentIcon name={segment} size={11} color={palette.muted} />}
                <Text
                  numberOfLines={1}
                  style={[
                    styles.segmentText,
                    {
                      fontWeight: isLast ? "600" : "400",
                      color: isLast ? palette.accentLight : palette.muted,
                    },
                  ]}
                >
                  {segment}
                </Text>
              </Pressable>
            </Animated.View>
            {!isLast && <ChevronRight size={11} color={separatorColor} strokeWidth={2} style={styles.separator} />}
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingHorizontal: 2,
    gap: 2,
  },
  folderIcon: {
    marginRight: 2,
  },
  segmentRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  segment: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  segmentText: {
    fontSize: 12,
    maxWidth: 120,
  },
  separator: {
    marginHorizontal: 1,
  },
})
