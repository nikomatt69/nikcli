import { View } from "react-native"
import { SkeletonBox } from "@/components/Skeleton"

export function SessionListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View className="gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} className="overflow-hidden rounded-[8px] border border-line/60 p-4" style={{ gap: 10 }}>
          <View className="flex-row items-center justify-between" style={{ gap: 12 }}>
            <SkeletonBox width="60%" height={15} borderRadius={6} />
            <SkeletonBox width={56} height={11} borderRadius={6} />
          </View>
          <SkeletonBox width="90%" height={12} borderRadius={6} />
          <View className="flex-row" style={{ gap: 8 }}>
            <SkeletonBox width={68} height={20} borderRadius={10} />
            <SkeletonBox width={52} height={20} borderRadius={10} />
          </View>
        </View>
      ))}
    </View>
  )
}
