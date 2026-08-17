import { StyleSheet, View } from "react-native"
import { Image } from "expo-image"
import { useUIStore } from "@/lib/store"
import { usePrefersReducedTransparency } from "@/lib/animation"

export function SessionWallpaper() {
  const wallpaper = useUIStore((state) => state.wallpaper)
  const reduced = usePrefersReducedTransparency()
  if (reduced || !wallpaper.enabled || !wallpaper.uri) return null
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        source={{ uri: wallpaper.uri }}
        style={[StyleSheet.absoluteFill, { opacity: wallpaper.opacity }]}
        contentFit="cover"
      />
    </View>
  )
}
