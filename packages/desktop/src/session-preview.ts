export type SessionPreviewKind = "html" | "markdown" | "image" | "video" | "text"

export type SessionPreviewItem = {
  id: string
  title: string
  description?: string
  kind: SessionPreviewKind
  version?: number
  url: string
  viewerUrl?: string
  previewUrl: string
}

/** Reload the embedded viewer when an artifact is updated in place. */
export function sessionPreviewFrameUrl(item: SessionPreviewItem): string {
  const value = item.viewerUrl ?? item.previewUrl
  if (!item.version) return value

  try {
    const url = new URL(value)
    url.searchParams.set("_nikcli_preview", String(item.version))
    return url.toString()
  } catch {
    return value
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function kind(value: unknown): SessionPreviewKind | undefined {
  if (value === "html" || value === "markdown" || value === "image" || value === "video" || value === "text") {
    return value
  }
}

function mediaFile(value: unknown): SessionPreviewItem | undefined {
  const file = record(value)
  if (!file) return

  const mime = string(file.mime)
  const url = string(file.url)
  if (!mime || !url) return

  const mediaKind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : undefined
  if (!mediaKind) return

  const id = string(file.id) ?? `${mediaKind}:${url}`
  const filename = string(file.filename)
  return {
    id: `media:${id}`,
    title: filename ?? (mediaKind === "image" ? "Image" : "Video"),
    kind: mediaKind,
    url,
    previewUrl: url,
  }
}

function publishedArtifact(value: unknown): SessionPreviewItem | undefined {
  const part = record(value)
  if (!part || part.type !== "tool" || part.tool !== "artifact") return

  const state = record(part.state)
  if (!state || state.status !== "completed") return

  const metadata = record(state.metadata)
  if (!metadata) return

  const artifactID = string(metadata.id)
  const artifactKind = kind(metadata.kind)
  const url = string(metadata.url)
  if (!artifactID || !artifactKind || !url) return

  const viewerUrl = string(metadata.viewerUrl)
  const rawUrl = string(metadata.previewUrl)
  const previewUrl =
    artifactKind === "image" || artifactKind === "video" ? (rawUrl ?? viewerUrl) : (viewerUrl ?? rawUrl)
  if (!previewUrl) return

  return {
    id: `artifact:${artifactID}`,
    title: string(metadata.title) ?? string(state.title) ?? "Artifact",
    description: string(metadata.description),
    kind: artifactKind,
    version: number(metadata.version) ?? 1,
    url,
    viewerUrl,
    previewUrl,
  }
}

/** Collect published artifacts and image/video attachments in transcript order. */
export function collectSessionPreviews(parts: readonly unknown[]): SessionPreviewItem[] {
  const items = new Map<string, SessionPreviewItem>()

  const add = (item: SessionPreviewItem | undefined) => {
    if (!item) return
    // Re-insertion keeps an updated artifact at the position of its newest version.
    items.delete(item.id)
    items.set(item.id, item)
  }

  for (const value of parts) {
    const part = record(value)
    if (!part) continue

    add(publishedArtifact(part))
    if (part.type === "file") add(mediaFile(part))

    const state = record(part.state)
    if (state?.status !== "completed" || !Array.isArray(state.attachments)) continue
    for (const attachment of state.attachments) add(mediaFile(attachment))
  }

  return [...items.values()]
}
