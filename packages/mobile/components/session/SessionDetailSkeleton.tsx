import { View } from "react-native"
import { SkeletonBox } from "@/components/Skeleton"
import { hexToRgba, useAppTheme } from "@/lib/theme"

function BubbleSkeleton(props: { align: "left" | "right"; width: `${number}%` | number }) {
  const { palette } = useAppTheme()
  return (
    <View style={{ marginBottom: 12, alignItems: props.align === "right" ? "flex-end" : "flex-start" }}>
      <View
        style={{
          width: props.width,
          maxWidth: "92%",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: hexToRgba(palette.border, 0.8),
          backgroundColor: hexToRgba(palette.surface, 0.55),
          padding: 14,
          gap: 8,
        }}
      >
        <SkeletonBox width="38%" height={10} borderRadius={6} />
        <SkeletonBox width="100%" height={12} borderRadius={6} />
        <SkeletonBox width="88%" height={12} borderRadius={6} />
        <SkeletonBox width="72%" height={12} borderRadius={6} />
      </View>
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

      <View style={{ flexDirection: "row", gap: 12 }}>
        <SkeletonBox width={286} height={168} borderRadius={8} />
        <SkeletonBox width={286} height={168} borderRadius={8} />
      </View>

      <BubbleSkeleton align="right" width="68%" />
      <BubbleSkeleton align="left" width="84%" />
      <BubbleSkeleton align="left" width="76%" />

      <View style={{ marginTop: "auto", gap: 8, paddingBottom: 8 }}>
        <SkeletonBox width="100%" height={44} borderRadius={8} />
        <SkeletonBox width="100%" height={52} borderRadius={8} />
      </View>
    </View>
  )
}
