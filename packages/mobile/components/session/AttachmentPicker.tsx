import type { RefObject } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import * as DocumentPicker from "expo-document-picker"
import * as FileSystem from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { FileText, Image, type LucideIcon } from "lucide-react-native"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { useAppTheme } from "@/lib/theme"

const SHEET_DISMISS_DELAY_MS = 220

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readBase64(uri?: string, fallback?: string | null) {
  if (fallback) return fallback
  if (!uri) return null
  return FileSystem.readAsStringAsync(uri, { encoding: "base64" })
}

type Props = {
  sheetRef: RefObject<ActionSheetRef>
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

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3.5 px-5 py-4"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
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
    </Pressable>
  )
}

export function AttachmentPicker({ sheetRef, onFile }: Props) {
  const { palette, isDark } = useAppTheme()

  async function dismissSheet() {
    sheetRef.current?.dismiss()
    await wait(SHEET_DISMISS_DELAY_MS)
  }

  async function pickDocument() {
    try {
      await dismissSheet()
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
      if (result.canceled || !result.assets?.[0]) return

      const asset = result.assets[0]
      const base64 = await readBase64(asset.uri)
      if (!base64) throw new Error("Missing document data")

      onFile(asset.mimeType ?? "application/octet-stream", asset.name, base64)
    } catch {
      Alert.alert("Unable to attach document", "Try again or choose a different file.")
    }
  }

  async function pickImage() {
    try {
      await dismissSheet()
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert("Photo access needed", "Allow photo library access to attach an image.")
        return
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.85,
      })
      if (result.canceled || !result.assets?.[0]) return

      const asset = result.assets[0]
      const base64 = await readBase64(asset.uri, asset.base64)
      if (!base64) throw new Error("Missing image data")

      const mime = asset.mimeType ?? "image/jpeg"
      const filename = asset.fileName ?? `image_${Date.now()}.jpg`
      onFile(mime, filename, base64)
    } catch {
      Alert.alert("Unable to attach image", "Try again or choose a different photo.")
    }
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
