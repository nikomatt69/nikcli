import { View } from "react-native"
import { SkeletonBox } from "@/components/Skeleton"
import { hexToRgba, useAppTheme } from "@/lib/theme"

export function RepoCardSkeleton({ count = 2 }: { count?: number }) {
  const { palette } = useAppTheme()

  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          style={{
            overflow: "hidden",
            gap: 12,
            padding: 16,
            borderRadius: 18,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, 0.08),
            backgroundColor: palette.surfaceRaised,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBox width={120} height={10} borderRadius={6} />
              <SkeletonBox width="70%" height={16} borderRadius={6} />
              <SkeletonBox width="45%" height={12} borderRadius={6} />
            </View>
            <SkeletonBox width={64} height={28} borderRadius={8} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SkeletonBox width={72} height={22} borderRadius={11} />
            <SkeletonBox width={88} height={22} borderRadius={11} />
          </View>
        </View>
      ))}
    </View>
  )
}
