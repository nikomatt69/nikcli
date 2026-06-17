import type { RefObject } from "react"
import { useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import * as DocumentPicker from "expo-document-picker"
import { File } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { FileText, Image, type LucideIcon } from "lucide-react-native"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"

type Props = {
  sheetRef: RefObject<ActionSheetRef | null>
  onFile(mime: string, filename: string, base64: string): void
}

type RowProps = {
  Icon: LucideIcon
  label: string
  description: string
  onPress(): void
}

function PickerRow({ Icon, label, description, onPress }: RowProps) {
  const { palette, isDark } = useAppTheme()
  const scaleAnimRef = useRef<Animated.Value | null>(null)
  if (scaleAnimRef.current === null) scaleAnimRef.current = new Animated.Value(1)
  const scaleAnim = scaleAnimRef.current

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      damping: 20,
      stiffness: 280,
      mass: 0.85,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 18,
      stiffness: 300,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  const handlePress = () => {
    void triggerHaptic("selection")
    onPress()
  }

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <View className="flex-row items-center gap-3.5 px-5 py-4">
          <View
            className="shrink-0 items-center justify-center rounded-[14px]"
            style={{
              width: 46,
              height: 46,
              backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.09)",
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.18)",
            }}
          >
            <Icon size={20} color={palette.accentLight} strokeWidth={2.1} />
          </View>
          <View className="flex-1">
            <Text className="text-[15px] font-semibold leading-5 tracking-tight text-ink">{label}</Text>
            <Text className="mt-0.5 text-[12.5px] leading-4 text-muted">{description}</Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  )
}

export function AttachmentPicker({ sheetRef, onFile }: Props) {
  const { palette, isDark } = useAppTheme()

  async function pickDocument() {
    sheetRef.current?.dismiss()
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = await new File(asset.uri).base64()
    onFile(asset.mimeType ?? "application/octet-stream", asset.name, base64)
  }

  async function pickImage() {
    sheetRef.current?.dismiss()
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.85,
    })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    if (!asset.base64) return
    const mime = asset.mimeType ?? "image/jpeg"
    const filename = asset.fileName ?? `image_${Date.now()}.jpg`
    onFile(mime, filename, asset.base64)
  }

  return (
    <ActionSheet ref={sheetRef} snapPoints={[320]}>
      {/* Header */}
      <View className="border-b border-border px-5 pb-4">
        <Text className="text-[10px] font-bold uppercase tracking-[1.8px] text-accent">Attach file</Text>
        <Text className="mt-1.5 text-lg font-bold leading-6 tracking-tight text-ink">Choose a source</Text>
        <View
          className="mt-2 self-start rounded-full px-2.5 py-1"
          style={{
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.18)",
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.09)",
          }}
        >
          <Text className="text-[10px] font-semibold tracking-wide" style={{ color: palette.accentLight }}>
            Sent to active session
          </Text>
        </View>
      </View>

      {/* Rows */}
      <View>
        <PickerRow
          Icon={FileText}
          label="Attach document"
          description="PDF, TXT, code files, spreadsheets"
          onPress={() => void pickDocument()}
        />
        <View className="mx-5 h-px bg-border" />
        <PickerRow
          Icon={Image}
          label="Attach image"
          description="JPG, PNG, HEIC from your photo library"
          onPress={() => void pickImage()}
        />
        <View className="h-2" />
      </View>
    </ActionSheet>
  )
}
