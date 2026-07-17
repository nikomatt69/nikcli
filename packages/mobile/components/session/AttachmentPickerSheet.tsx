import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native"
import * as DocumentPicker from "expo-document-picker"
import { File } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { Camera, ChevronRight, FileText, FolderOpen, Image, Search, X } from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"

export type AttachmentPickerSheetProps = {
  visible: boolean
  onClose(): void
  onFile(mime: string, filename: string, base64: string, previewUri?: string): void
}

type AttachmentItemDef = {
  id: string
  title: string
  description: string
  icon: typeof FileText
}

const ATTACHMENT_ITEMS: AttachmentItemDef[] = [
  {
    id: "photo-library",
    title: "Photos & Videos",
    description: "JPG, PNG, HEIC, GIF and videos from your library",
    icon: Image,
  },
  {
    id: "camera",
    title: "Camera",
    description: "Take a new photo with your camera",
    icon: Camera,
  },
  {
    id: "document",
    title: "Document",
    description: "PDF, TXT, code files, spreadsheets",
    icon: FileText,
  },
  {
    id: "folder",
    title: "Browse Files",
    description: "Access files from folders",
    icon: FolderOpen,
  },
]

export function AttachmentPickerSheet({ visible, onClose, onFile }: AttachmentPickerSheetProps) {
  const { palette, isDark } = useAppTheme()
  const { width: SCREEN_WIDTH } = useWindowDimensions()
  const [searchQuery, setSearchQuery] = useState("")
  const slideAnimRef = useRef<Animated.Value | null>(null)
  if (slideAnimRef.current === null) slideAnimRef.current = new Animated.Value(0)
  const slideAnim = slideAnimRef.current
  const opacityAnimRef = useRef<Animated.Value | null>(null)
  if (opacityAnimRef.current === null) opacityAnimRef.current = new Animated.Value(0)
  const opacityAnim = opacityAnimRef.current
  const cardScaleAnimRef = useRef<Animated.Value | null>(null)
  if (cardScaleAnimRef.current === null) cardScaleAnimRef.current = new Animated.Value(0.92)
  const cardScaleAnim = cardScaleAnimRef.current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacityAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 1, damping: 20, stiffness: 260, mass: 0.8, useNativeDriver: true }),
        Animated.spring(cardScaleAnim, { toValue: 1, damping: 22, stiffness: 300, mass: 0.7, useNativeDriver: true }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(opacityAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(cardScaleAnim, { toValue: 0.92, duration: 160, useNativeDriver: true }),
      ]).start()
    }
  }, [visible, opacityAnim, slideAnim, cardScaleAnim])

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_WIDTH * 0.4, 0] })

  const filteredItems = ATTACHMENT_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleFileSelected = useCallback(
    (mime: string, filename: string, base64: string, previewUri?: string) => {
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
    })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    const isVideo = asset.type === "video"
    // `base64` is only populated for images; videos are read from disk.
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

  const itemActions: Record<string, () => void> = {
    "photo-library": handlePhotoLibrary,
    camera: handleCamera,
    document: handleDocument,
    folder: handleBrowse,
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacityAnim }]}>
        <View style={{ flex: 1 }}>
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 20 : 14}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(0,0,0,0.72)" : "rgba(20,20,19,0.20)"}
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(20,20,19,0.16)" }]}
          />

          <Pressable style={{ flex: 1 }} onPress={onClose} />

          <Animated.View style={{ paddingHorizontal: 16, paddingBottom: 24, transform: [{ translateY }] }}>
            <Animated.View
              style={[
                styles.card,
                {
                  transform: [{ scale: cardScaleAnim }],
                  shadowOpacity: isDark ? 0.45 : 0.14,
                },
              ]}
            >
              <AdaptiveBlur
                tint={isDark ? "dark" : "light"}
                intensity={isDark ? 92 : 80}
                style={StyleSheet.absoluteFill}
                fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: isDark ? "rgba(17,17,17,0.68)" : "rgba(255,255,255,0.62)" },
                ]}
                pointerEvents="none"
              />

              <View style={{ padding: 16 }}>
                <View style={styles.headerRow}>
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: "700",
                          color: palette.accentLight,
                          letterSpacing: 1.8,
                          textTransform: "uppercase",
                        }}
                      >
                        Attach
                      </Text>
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: "600", color: palette.ink }}>Choose a source</Text>
                    <Text style={{ fontSize: 14, lineHeight: 20, color: palette.soft }}>
                      Attach files, photos, or documents to your message.
                    </Text>
                  </View>

                  <CloseButton onPress={onClose} />
                </View>

                <View
                  style={[
                    styles.searchBar,
                    {
                      borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.80)",
                      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.55)",
                    },
                  ]}
                >
                  <Search size={16} color={palette.muted} strokeWidth={2.1} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search attachment types..."
                    placeholderTextColor={palette.muted}
                    selectionColor={palette.accent}
                    keyboardAppearance={isDark ? "dark" : "light"}
                    autoCapitalize="none"
                    style={{ flex: 1, fontSize: 15, color: palette.ink }}
                  />
                </View>

                <ScrollView style={{ marginTop: 16, maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                  <View style={{ gap: 10 }}>
                    {filteredItems.map((item) => {
                      const Icon = item.icon
                      return (
                        <AnimatedItemCard
                          key={item.id}
                          onPress={() => itemActions[item.id]?.()}
                          isDark={isDark}
                          palette={palette}
                        >
                          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
                            <View
                              style={[
                                styles.itemIcon,
                                {
                                  backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,19,0.09)",
                                  borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,19,0.16)",
                                },
                              ]}
                            >
                              <Icon size={22} color={palette.accentLight} strokeWidth={2} />
                            </View>

                            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                              <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{item.title}</Text>
                              <Text style={{ fontSize: 12, lineHeight: 18, color: palette.soft }} numberOfLines={2}>
                                {item.description}
                              </Text>
                            </View>

                            <ChevronRight size={18} color={palette.muted} strokeWidth={2} />
                          </View>
                        </AnimatedItemCard>
                      )
                    })}

                    {filteredItems.length === 0 && (
                      <View
                        style={[
                          styles.emptyCard,
                          {
                            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)",
                            backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.45)",
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>
                          No attachments found
                        </Text>
                        <Text style={{ marginTop: 4, fontSize: 12, lineHeight: 20, color: palette.soft }}>
                          Try a different search term.
                        </Text>
                      </View>
                    )}
                  </View>
                </ScrollView>
              </View>
            </Animated.View>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  )
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const { palette, isDark } = useAppTheme()
  const scaleAnimRef = useRef<Animated.Value | null>(null)
  if (scaleAnimRef.current === null) scaleAnimRef.current = new Animated.Value(1)
  const scaleAnim = scaleAnimRef.current

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      damping: 20,
      stiffness: 300,
      mass: 0.7,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 20,
      stiffness: 300,
      mass: 0.7,
      useNativeDriver: true,
    }).start()
  }

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={[
          styles.closeBtn,
          {
            transform: [{ scale: scaleAnim }],
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.80)",
            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)",
          },
        ]}
      >
        <X size={14} color={palette.soft} strokeWidth={2.5} />
      </Animated.View>
    </Pressable>
  )
}

function AnimatedItemCard({
  children,
  onPress,
  isDark,
  palette,
}: {
  children: React.ReactNode
  onPress: () => void
  isDark: boolean
  palette: { accentLight: string; ink: string; soft: string; accent: string }
}) {
  const scaleAnimRef = useRef<Animated.Value | null>(null)
  if (scaleAnimRef.current === null) scaleAnimRef.current = new Animated.Value(1)
  const scaleAnim = scaleAnimRef.current
  const borderGlowAnimRef = useRef<Animated.Value | null>(null)
  if (borderGlowAnimRef.current === null) borderGlowAnimRef.current = new Animated.Value(0)
  const borderGlowAnim = borderGlowAnimRef.current

  const handlePressIn = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 0.96,
        damping: 20,
        stiffness: 280,
        mass: 0.8,
        // Must match borderGlowAnim's JS driver: both animate the same
        // Animated.View, and borderColor cannot run on the native driver.
        useNativeDriver: false,
      }),
      Animated.spring(borderGlowAnim, {
        toValue: 1,
        damping: 22,
        stiffness: 260,
        mass: 0.7,
        useNativeDriver: false,
      }),
    ]).start()
  }

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        damping: 20,
        stiffness: 280,
        mass: 0.8,
        // Must match borderGlowAnim's JS driver (see handlePressIn).
        useNativeDriver: false,
      }),
      Animated.spring(borderGlowAnim, {
        toValue: 0,
        damping: 22,
        stiffness: 260,
        mass: 0.7,
        useNativeDriver: false,
      }),
    ]).start()
  }

  const borderColor = borderGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.78)", palette.accent],
  })

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={[
          styles.itemCard,
          {
            transform: [{ scale: scaleAnim }],
            borderColor,
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
  },
  itemIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  emptyCard: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
})
