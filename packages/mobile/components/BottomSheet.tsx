import React, { useRef } from "react"
import { Pressable, Text, View } from "react-native"
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView } from "@gorhom/bottom-sheet"
import Ionicons from "@expo/vector-icons/Ionicons"

type IoniconName = React.ComponentProps<typeof Ionicons>["name"]
type BottomSheetModalRef = React.ElementRef<typeof BottomSheetModal>

export const ActionSheet = React.forwardRef<
  BottomSheetModalRef,
  { children: React.ReactNode; snapPoints?: (string | number)[] }
>(function ActionSheet({ children, snapPoints = [280] }, ref) {
  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      backgroundStyle={{ backgroundColor: "#0a1829" }}
      handleIndicatorStyle={{ backgroundColor: "#2a4560", width: 36, height: 4 }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} />
      )}
      enablePanDownToClose
    >
      <BottomSheetView style={{ flex: 1, paddingBottom: 24 }}>{children}</BottomSheetView>
    </BottomSheetModal>
  )
})

export function ActionSheetItem({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: IoniconName
  label: string
  onPress(): void
  destructive?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 14,
        minHeight: 48,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: destructive ? "#7f1d1d20" : "#38bdf810",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={18} color={destructive ? "#fca5a5" : "#7dd3fc"} />
      </View>
      <Text
        style={{
          color: destructive ? "#fca5a5" : "#e6eef8",
          fontSize: 15,
          fontWeight: "500",
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function ActionSheetDivider() {
  return <View style={{ height: 1, backgroundColor: "#162840", marginHorizontal: 16, marginVertical: 4 }} />
}

export function useActionSheetRef() {
  return useRef<BottomSheetModalRef>(null)
}
