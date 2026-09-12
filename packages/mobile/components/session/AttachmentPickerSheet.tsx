import { useCallback } from "react"
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as DocumentPicker from "expo-document-picker"
import { File } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { Camera, FileText, FolderOpen, Image } from "lucide-react-native"
import { SheetShell } from "@/components/ui/SheetShell"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

export type AttachmentPickerSheetProps = {
  visible: boolean
  onClose(): void
  onFile(mime: string, filename: string, base64: string, previewUri?: string): void
}

type AttachmentItemDef = {
  id: "photo-library" | "camera" | "document" | "folder"
  title: string
  description: string
  icon: typeof FileText
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_DURATION_S = 60

const ATTACHMENT_ITEMS: AttachmentItemDef[] = [
  {
    id: "photo-library",
    title: "Photos & Videos",
    description: "JPG, PNG, HEIC, GIF, and short clips from your library",
    icon: Image,
  },
  {
    id: "camera",
    title: "Camera",
    description: "Take a new photo",
    icon: Camera,
  },
  {
    id: "document",
    title: "Document",
    description: "PDF, text, code, and spreadsheets",
    icon: FileText,
  },
  {
    id: "folder",
    title: "Browse Files",
    description: "Pick any file from Files",
    icon: FolderOpen,
  },
]

export function AttachmentPickerSheet({ visible, onClose, onFile }: AttachmentPickerSheetProps) {
  const { palette } = useAppTheme()
  const insets = useSafeAreaInsets()
  const items = ATTACHMENT_ITEMS.filter((item) => item.id !== "camera" || Platform.OS !== "web")

  const handleFileSelected = useCallback(
    (mime: string, filename: string, base64: string, previewUri?: string) => {
      const bytes = Math.floor((base64.length * 3) / 4)
      if (bytes > MAX_ATTACHMENT_BYTES) {
        void triggerHaptic("error")
        Alert.alert(
          "Attachment too large",
          `${filename} is ${(bytes / (1024 * 1024)).toFixed(1)} MB. Attachments are limited to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
        )
        return
      }
      void triggerHaptic("selection")
      onFile(mime, filename, base64, previewUri)
      onClose()
    },
    [onFile, onClose],
  )

  const handlePhotoLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      base64: true,
      quality: 0.85,
      videoMaxDuration: MAX_VIDEO_DURATION_S,
    })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    const isVideo = asset.type === "video"
    const base64 = asset.base64 ?? (await new File(asset.uri).base64())
    if (!base64) return
    const mime = asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg")
    const filename = asset.fileName ?? (isVideo ? `video_${Date.now()}.mp4` : `image_${Date.now()}.jpg`)
    handleFileSelected(mime, filename, base64, asset.uri)
  }

  const handleCamera = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.85,
    })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    if (!asset.base64) return
    const mime = asset.mimeType ?? "image/jpeg"
    const filename = asset.fileName ?? `camera_${Date.now()}.jpg`
    handleFileSelected(mime, filename, asset.base64, asset.uri)
  }

  const handleDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ["application/pdf", "text/plain", "text/markdown", "application/json"],
    })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = await new File(asset.uri).base64()
    handleFileSelected(asset.mimeType ?? "application/octet-stream", asset.name, base64)
  }

  const handleBrowse = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
    })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = await new File(asset.uri).base64()
    handleFileSelected(asset.mimeType ?? "application/octet-stream", asset.name, base64)
  }

  const itemActions: Record<AttachmentItemDef["id"], () => void> = {
    "photo-library": handlePhotoLibrary,
    camera: handleCamera,
    document: handleDocument,
    folder: handleBrowse,
  }

  return (
    <SheetShell visible={visible} onClose={onClose} accessibilityLabel="Attach">
      <View className="border-b border-border px-5 pb-4">
        <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>Attach</Text>
        <Text className="mt-1.5" style={{ color: palette.ink, ...typeStyle(18, { weight: "700" }) }}>
          Choose a source
        </Text>
        <Text className="mt-1" style={{ color: palette.muted, ...typeStyle(13) }}>
          Photos, files, or documents for this message.
        </Text>
      </View>

      <View style={{ paddingTop: 6, paddingBottom: Math.max(insets.bottom, 12) }}>
        {items.map((item, index) => (
          <SourceRow
            key={item.id}
            item={item}
            bordered={index < items.length - 1}
            onPress={() => {
              void triggerHaptic("selection")
              itemActions[item.id]()
            }}
          />
        ))}
      </View>
    </SheetShell>
  )
}

function SourceRow({
  item,
  bordered,
  onPress,
}: {
  item: AttachmentItemDef
  bordered: boolean
  onPress(): void
}) {
  const { palette, isDark } = useAppTheme()
  const Icon = item.icon

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={item.description}
      style={({ pressed }) => ({
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View
        style={{
          width: "100%",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 72,
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : hexToRgba(palette.ink, 0.08),
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: hexToRgba(palette.ink, 0.06),
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, 0.1),
          }}
        >
          <Icon size={18} color={palette.muted} strokeWidth={2.1} />
        </View>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <Text
            style={{
              color: palette.ink,
              fontSize: 15,
              fontWeight: "600",
              letterSpacing: -0.2,
            }}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text
            style={{
              marginTop: 3,
              color: palette.soft,
              fontSize: 12.5,
              lineHeight: 17,
            }}
            numberOfLines={2}
          >
            {item.description}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}
