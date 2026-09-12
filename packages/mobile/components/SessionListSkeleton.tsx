import { View } from "react-native"
import { SkeletonBox } from "@/components/Skeleton"
import { hexToRgba, useAppTheme } from "@/lib/theme"

/** Row-shaped placeholders matching SessionListItem: glyph slot + title + meta line. */
export function SessionListSkeleton({ count = 6 }: { count?: number }) {
  const { palette } = useAppTheme()

  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              paddingVertical: 13,
              paddingHorizontal: 4,
              minHeight: 44,
            }}
          >
            <View style={{ width: 16, alignItems: "center", marginTop: 3 }}>
              <SkeletonBox width={8} height={8} borderRadius={999} />
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBox width="62%" height={17} borderRadius={6} />
              <SkeletonBox width="50%" height={13} borderRadius={6} />
            </View>
          </View>
          {index < count - 1 ? (
            <View style={{ height: 1, marginLeft: 32, backgroundColor: hexToRgba(palette.ink, 0.06) }} />
          ) : null}
        </View>
      ))}
    </View>
  )
}
