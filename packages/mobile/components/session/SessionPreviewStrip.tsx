import { forwardRef, useMemo, useState, type ReactNode } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ExternalLink, FolderOpen, Github, MonitorPlay, RefreshCw } from "lucide-react-native"
import { WebView } from "react-native-webview"
import * as WebBrowser from "expo-web-browser"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { EmptyState } from "@/components/ui/EmptyState"
import { useAppTheme } from "@/lib/theme"

export type SessionPreview = {
  id: string
  url: string
  source: "local" | "web"
}

/** Workspace context for the project tied to this session (repo, paths, quick actions). */
export type SessionProjectPanel = {
  sessionTitle: string
  /** Primary label: `owner/repo` or root directory */
  workspacePrimary: string
  /** Optional second line, e.g. worktree path */
  pathDetail?: string
  /** e.g. current branch for GitHub worktrees */
  branchLabel?: string
  githubUrl?: string
  onBrowseWorkspace?(): void
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
  return source === "local" ? "Local" : "Remote"
}

async function openPreviewExternally(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url)
    return
  } catch {
    /* WebView in-app sheet failed — try system handler */
  }
  try {
    await Linking.openURL(url)
  } catch {
    /* ignore */
  }
}

function statusTone(status: "loading" | "ready" | "failed", palette: ReturnType<typeof useAppTheme>["palette"]) {
  if (status === "ready") return { label: "Ready", color: palette.success }
  if (status === "failed") return { label: "Can't load", color: palette.warn }
  return { label: "Loading…", color: palette.muted }
}

function SectionHeader(props: {
  icon: ReactNode
  title: string
  right?: string
  palette: ReturnType<typeof useAppTheme>["palette"]
}) {
  return (
    <View style={{ marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {props.icon}
        <Text style={{ color: props.palette.ink, fontSize: 13, fontWeight: "800" }}>{props.title}</Text>
      </View>
      {props.right ? (
        <Text style={{ color: props.palette.muted, fontSize: 11, fontWeight: "700" }}>{props.right}</Text>
      ) : null}
    </View>
  )
}

function ProjectWorkspaceCard(props: {
  project: SessionProjectPanel
  isDark: boolean
  palette: ReturnType<typeof useAppTheme>["palette"]
}) {
  const { project, isDark, palette } = props
  const metaLine = [project.branchLabel, project.pathDetail].filter(Boolean).join(" · ")

  return (
    <View
      style={{
        marginBottom: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(218,216,209,0.86)",
        backgroundColor: isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.86)",
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ gap: 4, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ color: palette.ink, fontSize: 16, fontWeight: "800" }}>
          {project.sessionTitle}
        </Text>
        <Text numberOfLines={2} selectable style={{ color: palette.accentLight, fontSize: 13, fontWeight: "700" }}>
          {project.workspacePrimary}
        </Text>
        {metaLine ? (
          <Text numberOfLines={2} selectable style={{ color: palette.muted, fontSize: 11, fontWeight: "600" }}>
            {metaLine}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {project.onBrowseWorkspace ? (
          <Pressable
            onPress={project.onBrowseWorkspace}
            accessibilityRole="button"
            accessibilityLabel="Open files for this session"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(218,216,209,0.72)",
              paddingHorizontal: 12,
              paddingVertical: 9,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <FolderOpen size={14} color={palette.ink} strokeWidth={2.2} />
            <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "700" }}>Files</Text>
          </Pressable>
        ) : null}
        {project.githubUrl ? (
          <Pressable
            onPress={() => void Linking.openURL(project.githubUrl!)}
            accessibilityRole="button"
            accessibilityLabel="Open repository on GitHub"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 8,
              backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,19,0.10)",
              paddingHorizontal: 12,
              paddingVertical: 9,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Github size={14} color={palette.accentLight} strokeWidth={2.2} />
            <Text style={{ color: palette.accentLight, fontSize: 12, fontWeight: "800" }}>GitHub</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

export function SessionPreviewStrip({
  previews,
  project,
}: {
  previews: SessionPreview[]
  project?: SessionProjectPanel | null
}) {
  const { palette, isDark } = useAppTheme()
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({})
  const [previewStates, setPreviewStates] = useState<Record<string, "loading" | "ready" | "failed">>({})
  const visible = useMemo(() => previews.slice(0, 6), [previews])

  if (!project && !visible.length) return null

  return (
    <View style={{ marginBottom: 12 }}>
      {project ? (
        <>
          <SectionHeader
            icon={<FolderOpen size={15} color={palette.accentLight} strokeWidth={2.2} />}
            title="Session project"
            palette={palette}
          />
          <ProjectWorkspaceCard project={project} isDark={isDark} palette={palette} />
        </>
      ) : null}

      {visible.length ? (
        <>
          <SectionHeader
            icon={<MonitorPlay size={15} color={palette.accentLight} strokeWidth={2.2} />}
            title="App previews"
            right={`${visible.length}`}
            palette={palette}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 16 }}
          >
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
        </>
      ) : null}
    </View>
  )
}

/** Full-screen sheet: session folder + in-chat dev URLs (mobile-first copy). */
export type SessionPreviewSheetProps = {
  title: string
  previews: SessionPreview[]
  project?: SessionProjectPanel | null
}

export const SessionPreviewSheet = forwardRef<ActionSheetRef, SessionPreviewSheetProps>(function SessionPreviewSheet(
  { title, previews, project },
  ref,
) {
  const { palette, isDark } = useAppTheme()
  const hasContent = Boolean(project || previews.length)

  return (
    <ActionSheet ref={ref} snapPoints={["92%"]}>
      <View className="border-b border-border px-5 pb-4">
        <Text className="text-[12px] font-medium text-muted">Session preview</Text>
        <Text className="mt-1.5 text-lg font-bold leading-6 tracking-tight text-ink" numberOfLines={2}>
          {title || "Session"}
        </Text>
        <View
          className="mt-2 self-start rounded-full px-2.5 py-1"
          style={{
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(20,20,19,0.18)",
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,19,0.09)",
          }}
        >
          <Text className="text-[10px] font-semibold tracking-wide" style={{ color: palette.accentLight }}>
            Folder, repo & dev URLs
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {hasContent ? (
          <SessionPreviewStrip previews={previews} project={project} />
        ) : (
          <EmptyState
            title="No app previews yet"
            description="Dev links from the chat show here when they point at your server or local tunnel. Your session folder is above."
          />
        )}
      </ScrollView>
    </ActionSheet>
  )
})

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
        borderColor: props.isDark ? "rgba(255,255,255,0.10)" : "rgba(218,216,209,0.86)",
        backgroundColor: props.isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.86)",
      }}
    >
      <View
        style={{
          height: 168,
          overflow: "hidden",
          backgroundColor: props.isDark ? "#101010" : "#f8fafc",
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: props.isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,19,0.08)",
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
              {props.status === "failed" ? "Can't load page" : "Loading…"}
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
            <Text
              style={{ color: props.palette.accentLight, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}
            >
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
            accessibilityLabel="Reload this page"
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: props.isDark ? "rgba(255,255,255,0.10)" : "rgba(218,216,209,0.72)",
              paddingVertical: 9,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <RefreshCw size={13} color={props.palette.ink} strokeWidth={2.2} />
            <Text style={{ color: props.palette.ink, fontSize: 12, fontWeight: "700" }}>Reload</Text>
          </Pressable>
          <Pressable
            onPress={() => void openPreviewExternally(props.preview.url)}
            accessibilityRole="button"
            accessibilityLabel="Open in browser"
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderRadius: 8,
              backgroundColor: props.isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,19,0.10)",
              paddingVertical: 9,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ExternalLink size={13} color={props.palette.accentLight} strokeWidth={2.2} />
            <Text style={{ color: props.palette.accentLight, fontSize: 12, fontWeight: "800" }}>Browser</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}
