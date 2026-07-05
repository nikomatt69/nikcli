import { View } from "react-native"
import { SkeletonBox } from "@/components/Skeleton"
import { hexToRgba, useAppTheme } from "@/lib/theme"

/** Row-shaped placeholders matching SessionListItem: dot + title + meta line. */
export function SessionListSkeleton({ count = 6 }: { count?: number }) {
  const { palette } = useAppTheme()

  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index}>
          <View className="flex-row items-start" style={{ gap: 12, paddingVertical: 13, paddingHorizontal: 4 }}>
            <SkeletonBox width={8} height={8} borderRadius={999} style={{ marginTop: 6 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBox width="62%" height={14} borderRadius={6} />
              <SkeletonBox width="84%" height={11} borderRadius={6} />
            </View>
          </View>
          {index < count - 1 ? (
            <View style={{ height: 1, marginLeft: 24, backgroundColor: hexToRgba(palette.ink, 0.06) }} />
          ) : null}
        </View>
      ))}
    </View>
  )
}
