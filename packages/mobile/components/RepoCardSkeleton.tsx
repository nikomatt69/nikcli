import { View } from "react-native"
import { SkeletonBox } from "@/components/Skeleton"

export function RepoCardSkeleton({ count = 2 }: { count?: number }) {
  return (
    <View className="gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          className="overflow-hidden rounded-[8px] border border-line/60 p-4"
          style={{ gap: 12 }}
        >
          <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
            <View className="flex-1" style={{ gap: 8 }}>
              <SkeletonBox width={120} height={10} borderRadius={6} />
              <SkeletonBox width="70%" height={16} borderRadius={6} />
              <SkeletonBox width="45%" height={12} borderRadius={6} />
            </View>
            <SkeletonBox width={64} height={28} borderRadius={8} />
          </View>
          <View className="flex-row" style={{ gap: 8 }}>
            <SkeletonBox width={72} height={22} borderRadius={11} />
            <SkeletonBox width={88} height={22} borderRadius={11} />
          </View>
        </View>
      ))}
    </View>
  )
}
