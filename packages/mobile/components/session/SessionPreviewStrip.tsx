import { useMemo, useState } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ExternalLink, MonitorPlay, RefreshCw } from "lucide-react-native"
import { WebView } from "react-native-webview"
import { useAppTheme } from "@/lib/theme"

export type SessionPreview = {
  id: string
  url: string
  source: "local" | "web"
}

function labelForUrl(value: string) {
  try {
    const url = new URL(value)
    const host = url.host.replace(/^www\./, "")
    return url.pathname && url.pathname !== "/" ? `${host}${url.pathname}` : host
  } catch {
    return value
  }
}

function sourceLabel(source: SessionPreview["source"]) {
  return source === "local" ? "Dev preview" : "Web preview"
}

function statusTone(status: "loading" | "ready" | "failed", palette: ReturnType<typeof useAppTheme>["palette"]) {
  if (status === "ready") return { label: "Live", color: palette.success }
  if (status === "failed") return { label: "Offline", color: palette.warn }
  return { label: "Loading", color: palette.muted }
}

export function SessionPreviewStrip({ previews }: { previews: SessionPreview[] }) {
  const { palette, isDark } = useAppTheme()
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({})
  const [previewStates, setPreviewStates] = useState<Record<string, "loading" | "ready" | "failed">>({})
  const visible = useMemo(() => previews.slice(0, 6), [previews])

  if (!visible.length) return null

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MonitorPlay size={15} color={palette.accentLight} strokeWidth={2.2} />
          <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "800" }}>Project previews</Text>
        </View>
        <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "700" }}>{visible.length}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {visible.map((preview) => (
          <PreviewCard
            key={preview.id}
            preview={preview}
            reloadKey={reloadKeys[preview.id] ?? 0}
            status={previewStates[preview.id] ?? "loading"}
            isDark={isDark}
            palette={palette}
            onLoadStart={() => setPreviewStates((current) => ({ ...current, [preview.id]: "loading" }))}
            onLoad={() => setPreviewStates((current) => ({ ...current, [preview.id]: "ready" }))}
            onError={() => setPreviewStates((current) => ({ ...current, [preview.id]: "failed" }))}
            onReload={() =>
              setReloadKeys((current) => ({ ...current, [preview.id]: (current[preview.id] ?? 0) + 1 }))
            }
          />
        ))}
      </ScrollView>
    </View>
  )
}

function PreviewCard(props: {
  preview: SessionPreview
  reloadKey: number
  status: "loading" | "ready" | "failed"
  isDark: boolean
  palette: ReturnType<typeof useAppTheme>["palette"]
  onLoadStart(): void
  onLoad(): void
  onError(): void
  onReload(): void
}) {
  const status = statusTone(props.status, props.palette)

  return (
    <View
      style={{
        width: 286,
        overflow: "hidden",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: props.isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.86)",
        backgroundColor: props.isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.86)",
      }}
    >
      <View
        style={{
          height: 168,
          overflow: "hidden",
          backgroundColor: props.isDark ? "#101010" : "#f8fafc",
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: props.isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
        }}
      >
        <WebView
          key={`${props.preview.id}:${props.reloadKey}`}
          source={{ uri: props.preview.url }}
          startInLoadingState
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          onLoadStart={props.onLoadStart}
          onLoad={props.onLoad}
          onError={props.onError}
          style={{ flex: 1, backgroundColor: "transparent" }}
        />
        {props.status !== "ready" ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingHorizontal: 18,
                backgroundColor: props.isDark ? "rgba(8,8,8,0.76)" : "rgba(248,250,252,0.84)",
              },
            ]}
          >
            {props.status === "loading" ? <ActivityIndicator color={props.palette.accentLight} /> : null}
            <Text style={{ color: props.palette.ink, fontSize: 12, fontWeight: "800", textAlign: "center" }}>
              {props.status === "failed" ? "Preview unavailable" : "Loading preview"}
            </Text>
            <Text numberOfLines={1} style={{ color: props.palette.muted, fontSize: 10, textAlign: "center" }}>
              {labelForUrl(props.preview.url)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ padding: 12, gap: 10 }}>
        <View style={{ minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: props.palette.accentLight, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>
              {sourceLabel(props.preview.source)}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: status.color }} />
              <Text style={{ color: status.color, fontSize: 10, fontWeight: "800" }}>{status.label}</Text>
            </View>
          </View>
          <Text numberOfLines={1} style={{ marginTop: 3, color: props.palette.ink, fontSize: 13, fontWeight: "800" }}>
            {labelForUrl(props.preview.url)}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={props.onReload}
            accessibilityRole="button"
            accessibilityLabel="Reload preview"
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: props.isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.72)",
              paddingVertical: 9,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <RefreshCw size={13} color={props.palette.ink} strokeWidth={2.2} />
            <Text style={{ color: props.palette.ink, fontSize: 12, fontWeight: "700" }}>Reload</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(props.preview.url)}
            accessibilityRole="button"
            accessibilityLabel="Open preview externally"
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderRadius: 8,
              backgroundColor: props.isDark ? "rgba(255,255,255,0.10)" : "rgba(14,165,233,0.10)",
              paddingVertical: 9,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ExternalLink size={13} color={props.palette.accentLight} strokeWidth={2.2} />
            <Text style={{ color: props.palette.accentLight, fontSize: 12, fontWeight: "800" }}>Open</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}
