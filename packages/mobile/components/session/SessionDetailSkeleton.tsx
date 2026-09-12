import { View } from "react-native"
import { SkeletonBox } from "@/components/Skeleton"
import { hexToRgba, useAppTheme } from "@/lib/theme"

function UserBubbleSkeleton(props: { width: `${number}%` }) {
  const { palette, isDark } = useAppTheme()
  return (
    <View style={{ marginBottom: 12, width: "100%", alignItems: "flex-end" }}>
      <View
        style={{
          width: props.width,
          maxWidth: "82%",
          borderRadius: 18,
          borderCurve: "continuous",
          backgroundColor: hexToRgba(palette.ink, isDark ? 0.14 : 0.08),
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 8,
        }}
      >
        <SkeletonBox width="100%" height={12} borderRadius={6} />
        <SkeletonBox width="62%" height={12} borderRadius={6} />
      </View>
    </View>
  )
}

function AssistantTextSkeleton() {
  return (
    <View style={{ marginBottom: 16, width: "100%", gap: 8, paddingHorizontal: 2 }}>
      <SkeletonBox width="92%" height={12} borderRadius={6} />
      <SkeletonBox width="78%" height={12} borderRadius={6} />
      <SkeletonBox width="64%" height={12} borderRadius={6} />
    </View>
  )
}

export function SessionDetailSkeleton() {
  const { palette } = useAppTheme()

  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16, gap: 12 }}>
      <View
        style={{
          borderRadius: 8,
          borderWidth: 1,
          borderColor: hexToRgba(palette.border, 0.85),
          backgroundColor: hexToRgba(palette.surface, 0.45),
          padding: 14,
          gap: 10,
        }}
      >
        <SkeletonBox width="54%" height={14} borderRadius={6} />
        <SkeletonBox width="78%" height={11} borderRadius={6} />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <SkeletonBox width={72} height={28} borderRadius={8} />
          <SkeletonBox width={88} height={28} borderRadius={8} />
        </View>
      </View>

      <UserBubbleSkeleton width="42%" />
      <AssistantTextSkeleton />
      <UserBubbleSkeleton width="28%" />
      <AssistantTextSkeleton />

      <View style={{ marginTop: "auto", gap: 8, paddingBottom: 8 }}>
        <SkeletonBox width="100%" height={44} borderRadius={8} />
        <SkeletonBox width="100%" height={52} borderRadius={8} />
      </View>
    </View>
  )
}
